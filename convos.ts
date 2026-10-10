// Conversas: cada resposta é uma execução do CLI no modo estruturado (eventos JSON),
// traduzida pra itens que a página desenha (texto, comando, arquivos, raciocínio).
// A sessão nativa do agente é retomada enquanto a conta for a mesma; quando a conta
// muda (limite, rodízio, troca manual), a próxima recebe o histórico e continua.
// No modo "perguntar" o agente pede permissão antes de cada ação e a resposta vem da página.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const HANDOFF_CHARS = 14_000;
const HANDOFF_MSG_CHARS = 2_500;
const OUTPUT_CHARS = 12_000; // saída de comando guardada por item
const TURN_TIMEOUT_MS = 45 * 60_000;
const MAX_INLINE_IMAGE = 5_000_000;

export type Mode = "read" | "ask" | "edit" | "full";
type Acc = { id: string; provider: string; label: string; home: string | null };
export type Attachment = { id: string; name: string; path: string; image: boolean; mime: string };
export type Usage = { key: string; pct: number; resetsAt: number };
// o que a resposta custou em tokens, pelo que o próprio CLI informa (cache = entrada relida mais barata)
export type Tokens = { in: number; out: number; cache: number; usd?: number };
export type Item =
  | { k: string; kind: "text"; text: string }
  | { k: string; kind: "think"; text: string }
  | { k: string; kind: "cmd"; command: string; output: string; exit: number | null; status: string }
  | { k: string; kind: "files"; changes: { path: string; kind: string }[]; status: string }
  | { k: string; kind: "tool"; name: string; detail: string; output: string; status: string }
  | { k: string; kind: "todo"; items: { text: string; done: boolean }[] }
  | { k: string; kind: "note"; text: string; tone: "amber" | "red" | "mute" }
  | { k: string; kind: "ask"; req: string; tool: string; detail: string; state: "pending" | "allowed" | "denied" };
export type Msg = {
  role: "user" | "assistant"; at: number; text?: string; items?: Item[]; accountId?: string; attachments?: Attachment[];
  state?: "working" | "done" | "error" | "stopped"; error?: string; endedAt?: number; brain?: string[];
  tokens?: Tokens;
  review?: boolean;    // resposta de outra conta revisando o trabalho desta conversa
};
export type Convo = {
  id: string; title: string; cwd: string; target: string; mode: Mode; brain: boolean;
  accountId: string | null; provider: string; native: { accountId: string; sessionId: string } | null;
  messages: Msg[]; working: boolean; at: number; rev: number;
  waiting?: boolean;   // parado esperando o usuário permitir ou negar algo
  allow?: string[];    // ferramentas que o usuário mandou permitir sempre nesta conversa
  titled?: boolean;    // já tem título de verdade (gerado ou digitado)
  imported?: string;   // veio do histórico de outro programa
  // cópia de trabalho isolada criada pela Revoada pra esta conversa
  worktree?: { main: string; path: string; branch: string };
};

type Sink = {
  up: (key: string, item: Partial<Item> & { kind: Item["kind"] }) => void;
  session: (id: string) => void;
  fail: (msg: string) => void;
  done: () => void;
  usage: (windows: Usage[]) => void;
  ask: (req: string, tool: string, input: any) => void;
  tokens: (t: Tokens) => void;
};
type RunOpts = { prompt: string; ctx?: string; resume: string | null; mode: Mode; dirs: string[]; files: Attachment[] };
type Adapter = {
  args: (o: RunOpts) => string[];
  // CLI que conversa pela entrada padrão: o pedido vai por aqui e as permissões voltam por aqui
  stdin?: (o: RunOpts) => string;
  allow?: (req: string, input: any) => string;
  deny?: (req: string) => string;
  canAsk?: boolean;
  parse: (ev: any, s: Sink, st: any) => void;
};
const inline = (prompt: string, ctx?: string) => (ctx ? `${ctx}\n\n${prompt}` : prompt);
const clip = (s: unknown, n = OUTPUT_CHARS) => { const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s); return t.length > n ? t.slice(0, n) + "\n[…]" : t; };
// anexo que o CLI não recebe de forma nativa vai como caminho pro agente abrir
const withFiles = (prompt: string, files: Attachment[]) => (files.length ? `${prompt}\n\nArquivos anexados pelo usuário (abra pelo caminho):\n${files.map((f) => `- ${f.path}`).join("\n")}` : prompt);

const CODEX_SANDBOX = { read: "read-only", ask: "workspace-write", edit: "workspace-write", full: "danger-full-access" };
const ADAPTERS: Record<string, Adapter> = {
  codex: {
    args: ({ prompt, ctx, resume, mode, dirs, files }) => {
      const images = files.filter((f) => f.image), rest = files.filter((f) => !f.image);
      const text = withFiles(resume ? prompt : inline(prompt, ctx), rest);
      // o pedido vai antes das imagens: a flag -i aceita vários valores e engoliria o texto
      return resume
        ? ["exec", "resume", resume, "--json", "--skip-git-repo-check", "-c", `sandbox_mode="${CODEX_SANDBOX[mode]}"`, text, ...images.flatMap((f) => ["-i", f.path])]
        : ["exec", "--json", "--skip-git-repo-check", "-s", CODEX_SANDBOX[mode], ...dirs.flatMap((d) => ["--add-dir", d]), text, ...images.flatMap((f) => ["-i", f.path])];
    },
    parse(ev, s) {
      if (ev.type === "thread.started") return s.session(ev.thread_id);
      if (ev.type === "turn.completed") {
        const u = ev.usage || {}, cache = u.cached_input_tokens || 0;
        if (u.input_tokens || u.output_tokens) s.tokens({ in: Math.max(0, (u.input_tokens || 0) - cache), out: u.output_tokens || 0, cache });
        return s.done();
      }
      if (ev.type === "turn.failed") return s.fail(ev.error?.message || "o agente falhou");
      if (ev.type === "error") return s.up(`err:${ev.message}`, { kind: "note", text: ev.message, tone: "mute" });
      const it = ev.item;
      if (!it || !ev.type?.startsWith("item.")) return;
      if (it.type === "agent_message") s.up(it.id, { kind: "text", text: it.text || "" });
      else if (it.type === "reasoning") s.up(it.id, { kind: "think", text: it.text || "" });
      else if (it.type === "command_execution") s.up(it.id, { kind: "cmd", command: String(it.command || "").replace(/^\/bin\/(?:zsh|bash|sh) -lc /, "").replace(/^(['"])([\s\S]*)\1$/, "$2"), output: clip(it.aggregated_output), exit: it.exit_code ?? null, status: it.status || "" });
      else if (it.type === "file_change") s.up(it.id, { kind: "files", changes: (it.changes || []).map((c: any) => ({ path: c.path, kind: c.kind })), status: it.status || "" });
      else if (it.type === "todo_list") s.up(it.id, { kind: "todo", items: (it.items || []).map((t: any) => ({ text: t.text, done: !!t.completed })) });
      else if (it.type === "mcp_tool_call") s.up(it.id, { kind: "tool", name: `${it.server || "mcp"} · ${it.tool || ""}`, detail: clip(it.arguments, 400), output: clip(it.result ?? it.error ?? ""), status: it.status || "" });
      else if (it.type === "web_search") s.up(it.id, { kind: "tool", name: "busca na web", detail: it.query || "", output: "", status: "completed" });
      else if (it.type === "error") s.up(it.id, { kind: "note", text: it.message || "", tone: "red" });
    },
  },
  claude: {
    canAsk: true,
    args: ({ ctx, resume, mode, dirs }) => ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      ...(resume ? ["--resume", resume] : []), ...(ctx ? ["--append-system-prompt", ctx] : []),
      ...(mode === "ask" ? ["--permission-prompt-tool", "stdio"] : mode === "edit" ? ["--permission-mode", "acceptEdits"] : mode === "full" ? ["--dangerously-skip-permissions"] : []),
      "--add-dir", ...dirs], // variádica: fica por último
    stdin: ({ prompt, files }) => {
      const images = files.filter((f) => f.image), rest = files.filter((f) => !f.image);
      const blocks: any[] = [];
      for (const f of images) {
        try { const data = readFileSync(f.path); if (data.length <= MAX_INLINE_IMAGE) { blocks.push({ type: "image", source: { type: "base64", media_type: f.mime, data: data.toString("base64") } }); continue; } } catch {}
        rest.push(f);
      }
      blocks.push({ type: "text", text: withFiles(prompt, rest) });
      return JSON.stringify({ type: "user", message: { role: "user", content: blocks } }) + "\n";
    },
    allow: (req, input) => JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: req, response: { behavior: "allow", updatedInput: input } } }) + "\n",
    deny: (req) => JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: req, response: { behavior: "deny", message: "O usuário negou esta ação. Não tente de novo do mesmo jeito; explique o que precisava ou siga por outro caminho." } } }) + "\n",
    parse(ev, s, st) {
      if (ev.type === "system" && ev.subtype === "init") return s.session(ev.session_id);
      if (ev.type === "rate_limit_event") {
        const w = ev.rate_limit_info?.unifiedWindows || {};
        return s.usage(Object.entries<any>(w).map(([key, v]) => ({ key, pct: Math.round((v.utilization || 0) * 100), resetsAt: (v.resetsAt || 0) * 1000 })));
      }
      if (ev.type === "control_request") { if (ev.request?.subtype === "can_use_tool") s.ask(ev.request_id, ev.request.tool_name, ev.request.input || {}); return; }
      if (ev.type === "stream_event") {
        // texto e raciocínio chegam aos pedaços; a chave é a posição do bloco dentro da mensagem
        const e = ev.event || {};
        if (e.type === "message_start") st.mid = e.message?.id;
        else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") s.up(`${st.mid}:b${e.index}`, { kind: "text", text: e.delta.text, append: true } as any);
        else if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta") s.up(`${st.mid}:b${e.index}`, { kind: "think", text: e.delta.thinking, append: true } as any);
        return;
      }
      if (ev.type === "result") {
        if (ev.session_id) s.session(ev.session_id);
        const u = ev.usage;
        if (u) s.tokens({ in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), out: u.output_tokens || 0, cache: u.cache_read_input_tokens || 0, ...(typeof ev.total_cost_usd === "number" ? { usd: ev.total_cost_usd } : {}) });
        return ev.is_error ? s.fail(typeof ev.result === "string" && ev.result ? ev.result : ev.subtype || "o agente falhou") : s.done();
      }
      const blocks: any[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
      if (ev.type === "assistant") {
        st.seen ||= {};
        for (const b of blocks) {
          // cada bloco completo fecha o que veio aos pedaços na mesma posição
          const idx = (st.seen[ev.message.id] = (st.seen[ev.message.id] ?? -1) + 1);
          const key = `${ev.message.id}:b${idx}`;
          if (b.type === "text") s.up(key, { kind: "text", text: b.text });
          else if (b.type === "thinking") { if (b.thinking) s.up(key, { kind: "think", text: b.thinking }); }
          else if (b.type === "tool_use") {
            const inp = b.input || {};
            if (b.name === "Bash") s.up(b.id, { kind: "cmd", command: inp.command || "", output: "", exit: null, status: "in_progress" });
            else if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(b.name)) s.up(b.id, { kind: "files", changes: [{ path: inp.file_path || inp.notebook_path || "", kind: b.name === "Write" ? "add" : "update" }], status: "in_progress" });
            else if (b.name === "TodoWrite") s.up(b.id, { kind: "todo", items: (inp.todos || []).map((t: any) => ({ text: t.content, done: t.status === "completed" })) });
            else s.up(b.id, { kind: "tool", name: b.name, detail: clip(inp.file_path || inp.pattern || inp.query || inp.url || inp.description || inp, 400), output: "", status: "in_progress" });
          }
        }
      }
      if (ev.type === "user") for (const b of blocks) {
        if (b.type !== "tool_result") continue;
        const out = clip(Array.isArray(b.content) ? b.content.map((c: any) => c.text || "").join("\n") : b.content);
        // completa o item aberto pelo tool_use; o tipo dele já está lá
        s.up(b.tool_use_id, { kind: "tool", output: out, status: b.is_error ? "failed" : "completed", exit: b.is_error ? 1 : 0 } as any);
      }
    },
  },
  gemini: {
    args: ({ prompt, ctx, resume, mode, dirs, files }) => ["-p", withFiles(resume ? prompt : inline(prompt, ctx), files), "--output-format", "stream-json",
      ...(resume ? ["--resume", resume] : []), ...(mode === "edit" || mode === "ask" ? ["--approval-mode", "auto_edit"] : mode === "full" ? ["--approval-mode", "yolo"] : []),
      ...dirs.flatMap((d) => ["--include-directories", d])],
    parse(ev, s) {
      if (ev.type === "init" && ev.session_id) return s.session(ev.session_id);
      if (ev.type === "message" && ev.role === "assistant") return s.up("text", { kind: "text", text: ev.content || "", ...(ev.delta ? { append: true } : {}) } as any);
      if (ev.type === "tool_use") return s.up(ev.tool_id, { kind: "tool", name: ev.tool_name || "ferramenta", detail: clip(ev.parameters, 400), output: "", status: "in_progress" });
      if (ev.type === "tool_result") return s.up(ev.tool_id, { kind: "tool", output: clip(ev.output ?? ev.error ?? ""), status: ev.status === "success" ? "completed" : "failed" } as any);
      if (ev.type === "error") return s.fail(ev.message || ev.error?.message || "o agente falhou");
      if (ev.type === "result") {
        const u = ev.stats;
        if (u && (u.input_tokens || u.output_tokens)) s.tokens({ in: Math.max(0, (u.input_tokens || 0) - (u.cached || 0)), out: u.output_tokens || 0, cache: u.cached || 0 });
        return ev.status && ev.status !== "success" ? s.fail(ev.error?.message || "o agente falhou") : s.done();
      }
    },
  },
  // sem modo estruturado conhecido: a resposta inteira vira um texto só
  grok: { args: ({ prompt, ctx, files, mode }) => ["-p", withFiles(inline(prompt, ctx), files), ...(mode === "read" ? ["--deny", "Edit"] : [])], parse() {} },
};

export function createConvos(d: {
  dir: string; vault: string; attachDir: string;
  account: (id: string | null) => Acc | undefined;
  accName: (a: Acc | undefined) => string;
  binPath: (provider: string) => string | null;
  envFor: (a: Acc) => Record<string, string>;
  pick: (provider: string, skip: string[]) => Acc | undefined;
  isReady: (a: Acc) => boolean;
  markLimited: (a: Acc, text: string) => void;
  limitRe: RegExp; strictRe: RegExp; rotate: () => boolean;
  brainContext: (query: string, hint: string) => Promise<{ text: string; notes: string[] } | null>;
  onIdle: () => void;
  // garante que a pasta de trabalho existe (a cópia isolada pode ter sido limpa)
  prepare: (c: Convo) => Promise<void>;
  onUsage: (a: Acc, windows: Usage[]) => void;
  afterTurn: (a: Acc, sessionId: string) => void;
  makeTitle: (c: Convo) => Promise<string | null>;
  // resposta pronta: o servidor decide se pede revisão sozinho
  afterDone?: (c: Convo, msg: Msg) => void;
  // no modo "perguntar": ação que pode seguir sem passar pelo usuário (só leitura)
  autoAllow?: (tool: string, input: any) => boolean;
}) {
  mkdirSync(d.dir, { recursive: true });
  const convos = new Map<string, Convo>();
  const procs = new Map<string, { proc: any; stopped: boolean }>();
  const asks = new Map<string, Map<string, (allow: boolean) => void>>(); // conversa -> pedido -> resposta
  const timers = new Map<string, any>();

  for (const f of readdirSync(d.dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const c: Convo = JSON.parse(readFileSync(join(d.dir, f), "utf8"));
      c.working = false;
      c.waiting = false;
      // o servidor caiu no meio da resposta: ela fica como interrompida
      for (const m of c.messages) {
        if (m.state === "working") m.state = "stopped";
        for (const it of m.items || []) if (it.kind === "ask" && it.state === "pending") it.state = "denied";
      }
      convos.set(c.id, c);
    } catch {}
  }

  function touch(c: Convo) {
    c.rev++;
    c.at = Date.now();
    if (timers.has(c.id)) return;
    timers.set(c.id, setTimeout(() => { timers.delete(c.id); if (convos.has(c.id)) writeFileSync(join(d.dir, `${c.id}.json`), JSON.stringify(c)); }, 800));
  }

  // o que já foi dito e feito, pra uma conta nova continuar de onde a outra parou
  function handoff(c: Convo, upTo: number, partial: Msg, why: string): string | null {
    const describe = (m: Msg) => {
      if (m.role === "user") return `[usuário]\n${clip(m.text, HANDOFF_MSG_CHARS)}${m.attachments?.length ? `\n(anexos: ${m.attachments.map((a) => a.path).join(", ")})` : ""}`;
      const acts: string[] = [];
      let text = "";
      for (const it of m.items || []) {
        if (it.kind === "text") text += it.text + "\n";
        else if (it.kind === "cmd") acts.push(`rodou: ${clip(it.command, 160)}${it.exit != null ? ` (saída ${it.exit})` : ""}`);
        else if (it.kind === "files") acts.push(`editou: ${it.changes.map((x) => x.path).join(", ")}`);
        else if (it.kind === "tool") acts.push(`usou: ${it.name}`);
        else if (it.kind === "ask" && it.state === "denied") acts.push(`o usuário negou: ${it.tool} ${clip(it.detail, 120)}`);
      }
      return `[${m.review ? "revisão feita por outra conta" : "agente"}: ${d.accName(d.account(m.accountId || null))}${m.state === "error" ? ", terminou com erro" : m.state === "stopped" ? ", interrompido" : ""}]\n${clip(text.trim(), HANDOFF_MSG_CHARS)}${acts.length ? "\n" + acts.map((a) => `- ${a}`).join("\n") : ""}`;
    };
    const past = c.messages.slice(0, upTo).map(describe);
    if (partial.items?.some((i) => i.kind !== "note")) past.push(describe({ ...partial, state: "stopped" }) + "\n[esta resposta foi interrompida no meio; confira o estado dos arquivos antes de refazer algo]");
    if (!past.length) return null;
    // cabe no orçamento: sempre a primeira mensagem e o máximo das mais recentes
    const keep: string[] = [];
    let used = past[0].length;
    for (let i = past.length - 1; i > 0 && used + past[i].length < HANDOFF_CHARS; i--) { keep.unshift(past[i]); used += past[i].length; }
    const skipped = past.length - 1 - keep.length;
    return `<conversa-anterior>\nEsta conversa vinha sendo feita por outra conta de agente (${why}). Abaixo está o que foi dito e feito até aqui; os arquivos da pasta de trabalho já refletem esse trabalho. Continue de onde parou, sem repetir o que já está pronto e sem comentar esta troca.\n\n${past[0]}\n\n${skipped > 0 ? `[… ${skipped} mensagens do meio omitidas …]\n\n` : ""}${keep.join("\n\n")}\n</conversa-anterior>\n\nMensagem atual do usuário:`;
  }

  async function exec(c: Convo, msg: Msg, acc: Acc, prompt: string, ctx: string | undefined, resume: string | null, attempt: number, files: Attachment[], force?: Mode) {
    const adapter = ADAPTERS[acc.provider];
    const bin = d.binPath(acc.provider);
    if (!bin) return { ok: false, limit: false, stopped: false, produced: false, err: "CLI não instalado" };
    let finished = false, failure = "", raw = "", produced = false, sessionId = "";
    const items = msg.items!;
    const st: any = {};
    // o agente que não sabe perguntar roda como "pode editar", e a conversa avisa
    const mode: Mode = force || (c.mode === "ask" && !adapter.canAsk ? "edit" : c.mode);
    if (!force && c.mode === "ask" && !adapter.canAsk && attempt === 0) items.push({ k: `note:ask:${items.length}`, kind: "note", text: "Este agente não pede permissão passo a passo. Rodando como \"pode editar\": mexe só na pasta de trabalho.", tone: "mute" });
    const opts: RunOpts = { prompt, ctx, resume, mode, dirs: [d.vault, ...(files.length ? [d.attachDir] : [])], files };
    const proc = Bun.spawn([bin, ...adapter.args(opts)], {
      cwd: c.cwd, env: { ...d.envFor(acc), TERM: "dumb", NO_COLOR: "1" }, stdin: adapter.stdin ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe",
    });
    const write = (s: string) => { try { proc.stdin.write(s); proc.stdin.flush(); } catch {} };
    const closeIn = () => { try { proc.stdin.end(); } catch {} };
    const pending = new Map<string, (allow: boolean) => void>();
    asks.set(c.id, pending);
    const sink: Sink = {
      up(key, item) {
        produced = true;
        const k = `${attempt}:${key}`;
        const cur = items.find((i) => i.k === k) as any;
        if (!cur) { const { append, ...rest } = item as any; items.push({ k, text: "", output: "", ...rest }); }
        else if ((item as any).append) cur.text += (item as any).text || "";
        // resultado de ferramenta chega sem saber o tipo do item aberto: preserva o tipo original
        else { const { append, ...rest } = item as any; Object.assign(cur, rest, { kind: cur.kind === "text" || cur.kind === "think" ? item.kind : cur.kind }); }
        touch(c);
      },
      session: (id) => { sessionId = id; },
      fail: (m) => { failure = m; closeIn(); },
      done: () => { finished = true; closeIn(); },
      usage: (w) => d.onUsage(acc, w),
      // uma resposta pode passar por mais de uma conta (rodízio): soma
      tokens: (t) => { const m = (msg.tokens ||= { in: 0, out: 0, cache: 0 }); m.in += t.in; m.out += t.out; m.cache += t.cache; if (t.usd != null) m.usd = (m.usd || 0) + t.usd; },
      ask(req, tool, input) {
        if (c.allow?.includes(tool) || d.autoAllow?.(tool, input)) return write(adapter.allow!(req, input));
        const detail = tool === "Bash" ? input.command || "" : input.file_path || input.notebook_path || input.url || input.pattern || clip(input, 300);
        const it: Item = { k: `${attempt}:ask:${req}`, kind: "ask", req, tool, detail: String(detail), state: "pending" };
        items.push(it);
        c.waiting = true;
        touch(c);
        pending.set(req, (allow) => {
          pending.delete(req);
          (it as any).state = allow ? "allowed" : "denied";
          c.waiting = pending.size > 0;
          touch(c);
          write(allow ? adapter.allow!(req, input) : adapter.deny!(req));
        });
      },
    };
    if (adapter.stdin) write(adapter.stdin(opts));
    const handle = { proc, stopped: false };
    procs.set(c.id, handle);
    const timer = setTimeout(() => proc.kill(), TURN_TIMEOUT_MS);
    let errTail = "";
    const readErr = (async () => { const dec = new TextDecoder(); for await (const ch of proc.stderr) errTail = (errTail + dec.decode(ch, { stream: true })).slice(-4000); })();
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any = null;
        if (line.startsWith("{")) { try { ev = JSON.parse(line); } catch {} }
        if (ev) { try { adapter.parse(ev, sink, st); } catch {} }
        else raw = (raw + line + "\n").slice(-6000);
      }
    }
    if (buf.trim()) raw = (raw + buf).slice(-6000);
    const code = await proc.exited;
    await readErr;
    clearTimeout(timer);
    procs.delete(c.id);
    asks.delete(c.id);
    c.waiting = false;
    for (const it of items) if (it.kind === "ask" && it.state === "pending") it.state = "denied";
    // CLI sem eventos (grok, ou erro antes de começar): o texto puro é a resposta
    if (!produced && raw.trim() && code === 0 && !failure) { sink.up("raw", { kind: "text", text: raw.trim() }); finished = true; }
    const ok = !failure && (finished || code === 0) && !handle.stopped;
    // avisos de inicialização do CLI não são o erro; o motivo de verdade costuma vir depois deles
    const noise = /YOLO mode is enabled|Approval mode overridden|Loaded cached credentials|^\s*at\s|^\s*$/;
    const errLines = errTail.split("\n").filter((l) => !noise.test(l));
    const broke = /credits are depleted|billing/i.test(errTail) ? "A chave de API desta conta está sem crédito no provedor. Recarregue ou troque a chave em Contas > Editar."
      : /must specify the GEMINI_API_KEY/i.test(errTail) ? "Esta conta do Gemini está configurada para chave de API e não achou nenhuma. Informe a chave em Contas > Editar." : "";
    const err = broke || failure || raw.trim() || errLines.slice(-6).join("\n");
    const said = items.filter((i) => i.kind === "text").map((i: any) => i.text).join("\n");
    const limit = !broke && !handle.stopped && (ok ? said.length < 400 && d.strictRe.test(said) : d.limitRe.test(`${err}\n${errTail}`));
    if (sessionId) d.afterTurn(acc, sessionId);
    return { ok: ok && !limit, limit, stopped: handle.stopped, produced, err: limit && ok ? said : err, sessionId };
  }

  async function runTurn(c: Convo, userIndex: number) {
    const userMsg = c.messages[userIndex];
    const userText = userMsg.text || "";
    const msg: Msg = { role: "assistant", at: Date.now(), items: [], state: "working" };
    c.messages.push(msg);
    c.working = true;
    touch(c);
    const tried: string[] = [];
    const note = (text: string, tone: "amber" | "red" | "mute") => msg.items!.push({ k: `note:${msg.items!.length}`, kind: "note", text, tone });
    let attempt = 0, retriedResume = false, why = "troca de conta";
    let forced: Acc | undefined; // a conta que o rodízio anunciou é a que roda em seguida
    try {
      await d.prepare(c);
      while (true) {
        const pool = c.target.startsWith("pool:");
        let acc: Acc | undefined;
        if (forced) { acc = forced; forced = undefined; }
        else if (pool) {
          // fica na mesma conta enquanto ela aguenta: é o que mantém a sessão nativa
          const cur = d.account(c.accountId);
          acc = cur && cur.provider === c.target.slice(5) && d.isReady(cur) && !tried.includes(cur.id) ? cur : d.pick(c.target.slice(5), tried);
        } else if (!tried.includes(c.target)) acc = d.account(c.target);
        if (!acc) {
          msg.state = "error";
          msg.error = tried.length ? "Todas as contas deste provedor bateram no limite. Escolha outro agente no campo abaixo e mande de novo: a conversa vai junto." : "Nenhuma conta pronta para este pedido.";
          break;
        }
        tried.push(acc.id);
        msg.accountId = acc.id;
        const resume = c.native && c.native.accountId === acc.id ? c.native.sessionId : null;
        let prompt = userText, ctx: string | undefined;
        if (!resume) {
          // sessão nova nesta conta: leva o cérebro e, se já havia conversa, o histórico
          const b = c.brain ? await d.brainContext(userText, c.cwd.split("/").pop() || "") : null;
          ctx = b?.text;
          msg.brain = b?.notes;
          const history = handoff(c, userIndex, msg, why);
          if (history) prompt = `${history}\n${userText}`;
        }
        c.accountId = acc.id;
        c.provider = acc.provider;
        touch(c);
        const r = await exec(c, msg, acc, prompt, ctx, resume, attempt++, userMsg.attachments || []);
        if (r.sessionId) c.native = { accountId: acc.id, sessionId: r.sessionId };
        if (r.stopped) { msg.state = "stopped"; break; }
        if (r.ok) { msg.state = "done"; break; }
        if (r.limit) {
          d.markLimited(acc, r.err);
          why = `a conta ${d.accName(acc)} bateu no limite de uso`;
          const next = pool && d.rotate() ? d.pick(acc.provider, tried) : undefined;
          if (next) { forced = next; note(`${d.accName(acc)} bateu no limite. Continuando em ${d.accName(next)}, com a conversa.`, "amber"); touch(c); continue; }
          note(`${d.accName(acc)} bateu no limite.`, "red");
          if (!pool || !d.rotate()) { msg.state = "error"; msg.error = "Conta no limite. Escolha outro agente no campo abaixo e mande de novo: a conversa vai junto."; break; }
          continue; // cai no "todas bateram"
        }
        // a sessão nativa pode ter sumido (limpeza do CLI): tenta uma vez do zero, com o histórico
        if (resume && !r.produced && !retriedResume) { retriedResume = true; c.native = null; tried.pop(); why = "a sessão anterior não pôde ser retomada"; continue; }
        msg.state = "error";
        msg.error = r.err || "O agente terminou com erro.";
        break;
      }
    } catch (e: any) {
      msg.state = "error";
      msg.error = String(e?.message || e);
    }
    msg.endedAt = Date.now();
    c.working = false;
    c.waiting = false;
    touch(c);
    d.onIdle();
    if (msg.state === "done") d.afterDone?.(c, msg);
    // primeira resposta pronta: troca a primeira linha do pedido por um título de verdade
    if (!c.titled && msg.state === "done") {
      c.titled = true;
      d.makeTitle(c).then((t) => { if (t && convos.has(c.id)) { c.title = t; touch(c); } }).catch(() => {});
    }
  }

  // Revisão cruzada: outra conta lê o que mudou nesta conversa, em modo só leitura, numa sessão
  // própria. A sessão nativa e a conta do autor não são tocadas; a resposta entra marcada como revisão.
  function review(c: Convo, o: { acc: Acc; patch: string; files: string[]; truncated: boolean }) {
    if (c.working) throw new Error("o agente ainda está respondendo");
    const asked = c.messages.filter((m) => m.role === "user").map((m) => clip(m.text, 1500)).join("\n---\n");
    const author = d.accName(d.account(c.accountId));
    const prompt = `Você é o revisor. Outro agente (${author}) fez o trabalho abaixo nesta pasta. Revise sem editar nada: você está em modo só leitura.

<pedido-do-usuario>
${clip(asked, 6000)}
</pedido-do-usuario>

Arquivos mexidos:
${o.files.map((f) => `- ${f}`).join("\n") || "- (nenhum listado)"}

<diff>
${o.patch}
</diff>${o.truncated ? "\n[o diff foi cortado por tamanho: abra os arquivos listados para ver o resto]" : ""}

Procure, nesta ordem: (1) defeito real: erro de lógica, caso não tratado, regressão, falha de segurança, dado perdido; (2) o que foi pedido e não foi feito, ou foi feito diferente do pedido; (3) o que foi feito sem ter sido pedido. Abra os arquivos em volta quando o diff não bastar. Não comente estilo nem gosto, e não proponha refatoração.

Responda em português, com uma lista numerada do mais grave para o menos. Cada item: arquivo e linha, o que quebra e em que situação. Se não achar nada que mereça correção, responda "Nada a corrigir." e uma linha dizendo o que conferiu.`;
    const msg: Msg = { role: "assistant", at: Date.now(), items: [], state: "working", accountId: o.acc.id, review: true };
    c.messages.push(msg);
    c.working = true;
    touch(c);
    (async () => {
      try {
        const r = await exec(c, msg, o.acc, prompt, undefined, null, 0, [], "read");
        if (r.limit) d.markLimited(o.acc, r.err);
        msg.state = r.stopped ? "stopped" : r.ok ? "done" : "error";
        if (!r.ok && !r.stopped) msg.error = r.limit ? `${d.accName(o.acc)} bateu no limite. Peça a revisão de novo: outra conta assume.` : r.err || "O revisor terminou com erro.";
      } catch (e: any) { msg.state = "error"; msg.error = String(e?.message || e); }
      msg.endedAt = Date.now();
      c.working = false;
      c.waiting = false;
      touch(c);
      d.onIdle();
    })();
    return msg;
  }

  function send(c: Convo, text: string, patch: { target?: string; mode?: Mode; brain?: boolean; attachments?: Attachment[] } = {}) {
    if (c.working) throw new Error("o agente ainda está respondendo");
    if (patch.target) c.target = patch.target;
    if (patch.mode) c.mode = patch.mode;
    if (typeof patch.brain === "boolean") c.brain = patch.brain;
    c.messages.push({ role: "user", at: Date.now(), text, attachments: patch.attachments?.length ? patch.attachments : undefined });
    runTurn(c, c.messages.length - 1);
  }

  function create(o: { prompt: string; target: string; cwd: string; mode: Mode; brain: boolean; worktree?: Convo["worktree"]; attachments?: Attachment[] }) {
    const c: Convo = {
      id: crypto.randomUUID().slice(0, 8), title: (o.prompt.split("\n")[0] || o.attachments?.[0]?.name || "Conversa").slice(0, 80), cwd: o.cwd, target: o.target, mode: o.mode, brain: o.brain,
      accountId: null, provider: o.target.startsWith("pool:") ? o.target.slice(5) : d.account(o.target)?.provider || "", native: null,
      messages: [], working: false, at: Date.now(), rev: 0, worktree: o.worktree,
    };
    convos.set(c.id, c);
    send(c, o.prompt, { attachments: o.attachments });
    return c;
  }

  return {
    create, send, review,
    get: (id: string) => convos.get(id),
    rename(id: string, title: string) { const c = convos.get(id); if (c) { c.title = title; c.titled = true; touch(c); } },
    // resposta do usuário a um pedido de permissão; "always" libera a ferramenta pelo resto da conversa
    decide(id: string, req: string, decision: "allow" | "always" | "deny") {
      const c = convos.get(id), fn = asks.get(id)?.get(req);
      if (!c || !fn) throw new Error("este pedido já foi respondido");
      if (decision === "always") { const it = c.messages.at(-1)?.items?.find((i) => i.kind === "ask" && i.req === req) as any; if (it) c.allow = [...new Set([...(c.allow || []), it.tool])]; }
      fn(decision !== "deny");
      // o que mais estiver na fila da mesma ferramenta sai junto
      if (decision === "always") for (const [r, f] of asks.get(id) || []) { const it = c.messages.at(-1)?.items?.find((i) => i.kind === "ask" && i.req === r) as any; if (it && c.allow!.includes(it.tool)) f(true); }
    },
    // conversa trazida do histórico de outro programa, já montada
    adopt(c: Convo) { if (!convos.has(c.id)) { convos.set(c.id, c); touch(c); } return convos.get(c.id)!; },
    natives: () => [...convos.values()].map((c) => c.native?.sessionId).filter(Boolean) as string[],
    stop(id: string) { const h = procs.get(id); if (h) { h.stopped = true; h.proc.kill(); } },
    remove(id: string) { this.stop(id); convos.delete(id); rmSync(join(d.dir, `${id}.json`), { force: true }); },
    list: () => [...convos.values()].map((c) => ({ id: c.id, title: c.title, cwd: c.cwd, at: c.at, working: c.working, waiting: !!c.waiting, accountId: c.accountId, target: c.target, startedAt: c.messages.at(-1)?.at || c.at, imported: c.imported })),
    // conversa mexida há pouco ainda conta: o usuário pode responder a qualquer momento
    inUse: (path: string) => [...convos.values()].some((c) => (c.working || Date.now() - c.at < 20 * 60_000) && (c.cwd === path || c.cwd.startsWith(path + "/"))),
    flush() { for (const c of convos.values()) writeFileSync(join(d.dir, `${c.id}.json`), JSON.stringify(c)); },
  };
}
