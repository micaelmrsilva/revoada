// Histórico dos outros programas: acha as conversas que o Claude Code e o Codex já
// guardaram nesta máquina e transforma cada uma numa conversa da Revoada, pronta pra
// continuar na mesma sessão nativa (mesmo id, mesma conta).
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";
import type { Convo, Item, Msg } from "./convos";

const PEEK_BYTES = 256_000;      // quanto do começo do arquivo basta pra título e pasta
const MAX_FILE_BYTES = 40_000_000;
const KEEP_MESSAGES = 80;        // conversa longa entra só com o final; o agente tem o resto na sessão dele
const LIVE_MS = 2 * 60_000;      // mexida agora há pouco: provavelmente aberta em outro programa

export type HistEntry = { src: "claude" | "codex"; file: string; sessionId: string; accountId: string; cwd: string; title: string; at: number };
type Home = { provider: string; accountId: string; dir: string };

const clip = (s: unknown, n: number) => { const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s); return t.length > n ? t.slice(0, n) + "\n[…]" : t; };
function head(file: string) {
  const fd = openSync(file, "r");
  try { const buf = Buffer.alloc(PEEK_BYTES); return buf.subarray(0, readSync(fd, buf, 0, PEEK_BYTES, 0)).toString("utf8"); } finally { closeSync(fd); }
}
const jsonLines = (text: string) => text.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[];
// o que o usuário digitou de verdade, sem blocos que o programa injeta
const typed = (s: unknown) => (typeof s === "string" && !/^\s*<(?:command-|local-command|system-reminder|task-notification|contexto-do-cerebro|conversa-anterior)/.test(s) && !/^Caveat:/.test(s) ? s.trim() : "");

function claudeText(content: any): string {
  if (typeof content === "string") return typed(content);
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text").map((b) => typed(b.text)).filter(Boolean).join("\n");
}

// Chamada avulsa: um pedido só, feito sem tela por um script (`claude -p`, `codex exec`). É teste
// ou automação, não conversa que alguém vá querer continuar, e some da lista.
function peekClaude(file: string): { cwd: string; title: string; sessionId: string } | null {
  let cwd = "", title = "", first = "", asked = 0, headless = false;
  for (const j of jsonLines(head(file))) {
    if (j.isSidechain) continue;
    if (!cwd && j.cwd) cwd = j.cwd;
    if (j.entrypoint === "sdk-cli") headless = true;
    if (j.type === "custom-title" && j.customTitle) title = j.customTitle;
    if (j.type === "user" && !j.isMeta && !j.isCompactSummary) { const t = claudeText(j.message?.content); if (t) { asked++; first ||= t; } }
  }
  if (headless && asked <= 1 && !title) return null;
  if (!cwd || !(title || first)) return null;
  return { cwd, title: (title || first.split("\n")[0]).slice(0, 80), sessionId: basename(file, ".jsonl") };
}

function codexUser(payload: any): string {
  const it = payload?.item;
  if (payload?.type !== "item_completed" || it?.type !== "UserMessage") return "";
  return (it.content || []).map((c: any) => typed(c.text)).filter(Boolean).join("\n");
}
function peekCodex(file: string): { cwd: string; title: string; sessionId: string } | null {
  let cwd = "", sessionId = "", first = "", asked = 0, headless = false;
  for (const j of jsonLines(head(file))) {
    const p = j.payload || {};
    if (j.type === "session_meta") { sessionId = p.id || p.session_id || ""; cwd ||= p.cwd || ""; headless = p.source === "exec" || p.originator === "codex_exec"; }
    if (j.type === "turn_context" && p.cwd) cwd ||= p.cwd;
    if (j.type === "event_msg") { const t = codexUser(p); if (t) { asked++; first ||= t; } }
  }
  if (headless && asked <= 1) return null;
  if (!cwd || !sessionId || !first) return null;
  return { cwd, sessionId, title: first.split("\n")[0].slice(0, 80) };
}

function loadClaude(file: string): Msg[] {
  const out: Msg[] = [];
  let cur: Msg | null = null;
  const open = new Map<string, any>();
  for (const j of jsonLines(readFileSync(file, "utf8"))) {
    if (j.isSidechain || j.isMeta) continue;
    const at = Date.parse(j.timestamp) || Date.now();
    const blocks: any[] = Array.isArray(j.message?.content) ? j.message.content : [];
    if (j.type === "user") {
      for (const b of blocks) if (b.type === "tool_result" && open.has(b.tool_use_id)) {
        const it = open.get(b.tool_use_id);
        it.output = clip(Array.isArray(b.content) ? b.content.map((c: any) => c.text || "").join("\n") : b.content, 6000);
        it.status = b.is_error ? "failed" : "completed";
        if (it.kind === "cmd") it.exit = b.is_error ? 1 : 0;
      }
      const text = j.isCompactSummary ? "" : claudeText(j.message?.content);
      if (text) { out.push({ role: "user", at, text }); cur = null; }
    } else if (j.type === "assistant") {
      if (!cur) { cur = { role: "assistant", at, items: [], state: "done", endedAt: at }; out.push(cur); }
      cur.endedAt = at;
      for (const b of blocks) {
        const k = `h:${cur.items!.length}`;
        if (b.type === "text" && b.text?.trim()) cur.items!.push({ k, kind: "text", text: b.text });
        else if (b.type === "tool_use") {
          const inp = b.input || {};
          const it: any = b.name === "Bash" ? { k, kind: "cmd", command: inp.command || "", ...(typeof inp.description === "string" && inp.description.trim() ? { desc: clip(inp.description.trim(), 200) } : {}), output: "", exit: null, status: "completed" }
            : ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(b.name) ? { k, kind: "files", changes: [{ path: inp.file_path || inp.notebook_path || "", kind: b.name === "Write" ? "add" : "update" }], status: "completed", output: "" }
            : { k, kind: "tool", name: b.name, detail: clip(inp.file_path || inp.pattern || inp.query || inp.url || inp.description || inp, 300), output: "", status: "completed" };
          cur.items!.push(it as Item);
          open.set(b.id, it);
        }
      }
    }
  }
  return out;
}

function loadCodex(file: string): Msg[] {
  const out: Msg[] = [];
  let cur: Msg | null = null;
  const open = new Map<string, any>();
  const bot = (at: number) => { if (!cur) { cur = { role: "assistant", at, items: [], state: "done", endedAt: at }; out.push(cur); } cur.endedAt = at; return cur; };
  for (const j of jsonLines(readFileSync(file, "utf8"))) {
    const p = j.payload || {}, at = Date.parse(j.timestamp) || Date.now();
    if (j.type === "event_msg") {
      const text = codexUser(p);
      if (text) { out.push({ role: "user", at, text }); cur = null; }
    } else if (j.type === "response_item") {
      if (p.type === "message" && p.role === "assistant") {
        const text = (p.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("\n");
        if (text.trim()) { const m = bot(at); m.items!.push({ k: `h:${m.items!.length}`, kind: "text", text }); }
      } else if (p.type === "custom_tool_call" || p.type === "function_call") {
        const m = bot(at), raw = String(p.input ?? p.arguments ?? "");
        const cmd = raw.match(/cmd:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, "\n") || raw.match(/"command":\s*\[?"((?:[^"\\]|\\.)*)"/)?.[1] || "";
        const it: any = cmd ? { k: `h:${m.items!.length}`, kind: "cmd", command: cmd, output: "", exit: null, status: "completed" } : { k: `h:${m.items!.length}`, kind: "tool", name: p.name || "ferramenta", detail: clip(raw, 300), output: "", status: "completed" };
        m.items!.push(it);
        open.set(p.call_id, it);
      } else if ((p.type === "custom_tool_call_output" || p.type === "function_call_output") && open.has(p.call_id)) {
        const o = p.output;
        open.get(p.call_id).output = clip(Array.isArray(o) ? o.map((c: any) => c.text || "").join("\n") : o, 6000);
      }
    }
  }
  return out;
}

export function createHistory(o: { homes: () => Home[]; skipCwd: (cwd: string) => boolean; known: () => Set<string> }) {
  const cache = new Map<string, { mtime: number; entry: HistEntry | null }>();

  function files(): { src: "claude" | "codex"; accountId: string; file: string; mtime: number; size: number }[] {
    const out: any[] = [];
    const add = (src: string, accountId: string, file: string) => { try { const s = statSync(file); if (s.size > 200 && s.size < MAX_FILE_BYTES) out.push({ src, accountId, file, mtime: s.mtimeMs, size: s.size }); } catch {} };
    const ls = (d: string) => { try { return readdirSync(d); } catch { return []; } };
    for (const h of o.homes()) {
      if (h.provider === "claude") for (const p of ls(join(h.dir, "projects"))) for (const f of ls(join(h.dir, "projects", p))) { if (f.endsWith(".jsonl")) add("claude", h.accountId, join(h.dir, "projects", p, f)); }
      if (h.provider === "codex") for (const y of ls(join(h.dir, "sessions"))) for (const m of ls(join(h.dir, "sessions", y))) for (const day of ls(join(h.dir, "sessions", y, m))) for (const f of ls(join(h.dir, "sessions", y, m, day))) { if (f.startsWith("rollout-") && f.endsWith(".jsonl")) add("codex", h.accountId, join(h.dir, "sessions", y, m, day, f)); }
    }
    return out;
  }

  // conversas dos últimos dias, mais recentes primeiro
  function list(days = 45, max = 250): HistEntry[] {
    const since = Date.now() - days * 86_400_000, known = o.known();
    const out: HistEntry[] = [];
    for (const f of files().filter((x) => x.mtime > since && Date.now() - x.mtime > LIVE_MS).sort((a, b) => b.mtime - a.mtime)) {
      let c = cache.get(f.file);
      if (!c || c.mtime !== f.mtime) {
        let entry: HistEntry | null = null;
        try { const p = f.src === "claude" ? peekClaude(f.file) : peekCodex(f.file); if (p) entry = { src: f.src, file: f.file, accountId: f.accountId, at: f.mtime, ...p }; } catch {}
        c = { mtime: f.mtime, entry };
        cache.set(f.file, c);
      }
      // fora: o que a própria Revoada criou e o que roda em pasta interna dela
      if (c.entry && !known.has(c.entry.sessionId) && !o.skipCwd(c.entry.cwd)) out.push(c.entry);
      if (out.length >= max) break;
    }
    return out;
  }

  function counts() {
    const all = files(), n: Record<string, number> = {};
    for (const f of all) n[f.src] = (n[f.src] || 0) + 1;
    return n;
  }

  function toConvo(file: string): Convo {
    const e = list(3650, 100_000).find((x) => x.file === file);
    if (!e) throw new Error("conversa não encontrada no histórico");
    const all = e.src === "claude" ? loadClaude(e.file) : loadCodex(e.file);
    const messages = all.slice(-KEEP_MESSAGES);
    if (all.length > messages.length) messages.unshift({ role: "assistant", at: messages[0]?.at || e.at, state: "done", items: [{ k: "h:cut", kind: "note", tone: "mute", text: `${all.length - messages.length} mensagens mais antigas não aparecem aqui. O agente continua com a sessão inteira.` }] });
    for (const m of messages) if (m.role === "assistant") m.accountId = e.accountId;
    return {
      id: `imp-${e.sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 14)}`, title: e.title, cwd: e.cwd, target: e.accountId, mode: "ask", brain: false,
      accountId: e.accountId, provider: e.src, native: { accountId: e.accountId, sessionId: e.sessionId },
      messages, working: false, at: e.at, rev: 0, titled: true, imported: e.src,
    };
  }

  return { list, counts, toConvo };
}
