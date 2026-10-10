// revoada: painel local pra rodar várias contas de agentes (Claude, Codex, Gemini, Grok).
// Cada conta é um perfil com diretório de config isolado; o login é o do CLI oficial.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, relative } from "path";
import { createBrain } from "./brain";
import { createClones } from "./clones";
import { createConvos, EFFORTS, validModel, type Attachment, type Mode, type Usage } from "./convos";
import { createHistory } from "./history";
import { createMissions, PLAN_PROMPT } from "./missions";
import { createRemote } from "./remote";
import { createSchedules } from "./schedule";
import { createTools } from "./tools";
import { readOnlyTool } from "./safe";

const HOME = homedir();
const ROOT = process.env.REVOADA_HOME || join(HOME, ".revoada");
const PORT = Number(process.env.PORT || 4777);
// porta do acompanhamento pelo celular: a única que escuta fora de 127.0.0.1, e só quando ligada
const REMOTE_PORT = Number(process.env.REVOADA_REMOTE_PORT || PORT + 1);
const PROFILES = join(ROOT, "profiles");
// pasta onde ficam os seus repositórios: é onde o painel procura projetos, instruções e clones
const PROJECTS = process.env.REVOADA_PROJECTS || join(HOME, "git");
const ACCOUNTS_FILE = join(ROOT, "accounts.json");
// no app desktop o servidor é um binário compilado e os arquivos da página vêm do bundle
const ASSETS = process.env.REVOADA_ASSETS;
const PUBLIC = ASSETS ? join(ASSETS, "public") : join(import.meta.dir, "public");
const VENDOR: Record<string, string> = Object.fromEntries(Object.entries({
  "xterm.js": "node_modules/@xterm/xterm/lib/xterm.js",
  "xterm.css": "node_modules/@xterm/xterm/css/xterm.css",
  "addon-fit.js": "node_modules/@xterm/addon-fit/lib/addon-fit.js",
}).map(([name, path]) => [name, ASSETS ? join(ASSETS, "vendor", name) : join(import.meta.dir, path)]));
const ENV_PATH = [...new Set([
  ...(process.env.PATH || "").split(":"),
  "/opt/homebrew/bin", "/usr/local/bin", join(HOME, ".local/bin"), join(HOME, ".grok/bin"),
])].filter(Boolean).join(":");
process.env.PATH = ENV_PATH; // git, gh e du rodam daqui também
const SCROLLBACK_BYTES = 400_000;
const AUTO_CLEAN_EVERY_MS = 30 * 60_000;
const JOB_TIMEOUT_MS = 15 * 60_000;
const MAX_RUNS = 40;
const MAX_HISTORY = 60;
const HISTORY = join(ROOT, "history");
const HISTORY_FILE = join(ROOT, "history.json");
const RUNS_FILE = join(ROOT, "runs.json");

const LIMITS_FILE = join(ROOT, "limits.json");
const SETTINGS_FILE = join(ROOT, "settings.json");
const DEFAULT_COOLDOWN_MS = 60 * 60_000;
// saída sem TTY que falhou: qualquer sinal de cota serve
const LIMIT_RE = /usage limit|hit your (?:usage |session |weekly |daily )?limit|limit reached|rate.?limit|RESOURCE_EXHAUSTED|quota (?:exceeded|exhausted)|exceeded your current quota|too many requests|credits are depleted|\b429\b/i;
// tela interativa (e resposta com exit 0): só as frases que os CLIs usam de fato
const LIMIT_STRICT_RE = /usage limit reached|hit your (?:usage |session |weekly |daily )?limit|limit reached\s*[∙·•|]\s*resets|RESOURCE_EXHAUSTED|exceeded your current quota/i;

mkdirSync(PROFILES, { recursive: true });
mkdirSync(HISTORY, { recursive: true });

type Account = { id: string; provider: string; label: string; home: string | null; env?: Record<string, string> };
type Status = { ok: boolean; detail: string; at: number };

type Provider = {
  name: string;
  bin: string;
  homeVar: string;
  // variáveis herdadas do shell que atropelariam o login do perfil isolado
  strip: string[];
  login: string[];
  // flag que libera o cofre do cérebro para o agente ler e escrever fora da pasta de trabalho
  dir: (vault: string) => string[];
  // arquivo de instruções globais que o CLI lê em toda sessão
  instructions: (acc: Account) => string;
  // sessão interativa que já começa com um pedido (ctx = bloco do cérebro)
  chat: (prompt: string, ctx?: string) => string[];
  headless: (prompt: string, edits: boolean, ctx?: string) => string[];
  status: (acc: Account) => Promise<{ ok: boolean; detail: string }>;
};

const fileExists = (p: string) => { try { return statSync(p).size > 0; } catch { return false; } };
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

// só o Claude aceita contexto fora do pedido; nos outros ele vai na frente do texto
const inline = (prompt: string, ctx?: string) => (ctx ? `${ctx}\n\n${prompt}` : prompt);

const PROVIDERS: Record<string, Provider> = {
  claude: {
    name: "Claude", bin: "claude", homeVar: "CLAUDE_CONFIG_DIR",
    strip: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    login: ["auth", "login"],
    dir: (v) => ["--add-dir", v],
    instructions: (acc) => join(acc.home || join(HOME, ".claude"), "CLAUDE.md"),
    chat: (p, ctx) => [...(ctx ? ["--append-system-prompt", ctx] : []), ...(p ? [p] : [])],
    headless: (p, edits, ctx) => ["-p", p, ...(ctx ? ["--append-system-prompt", ctx] : []), ...(edits ? ["--permission-mode", "acceptEdits"] : [])],
    status: async (acc) => {
      const r = await capture("claude", ["auth", "status"], acc);
      const j = readJsonText(r.out);
      if (!j) return { ok: false, detail: "sem resposta do CLI" };
      // mesmo e-mail pode ter mais de uma assinatura (pessoal e de time): mostra qual é esta
      const plan = j.subscriptionType ? j.subscriptionType[0].toUpperCase() + j.subscriptionType.slice(1) : "";
      const org = j.orgName && !String(j.orgName).includes("@") ? j.orgName : j.email;
      return { ok: !!j.loggedIn, detail: j.loggedIn ? [plan, org || j.authMethod].filter(Boolean).join(" · ") || "logado" : "sem login" };
    },
  },
  codex: {
    name: "Codex", bin: "codex", homeVar: "CODEX_HOME",
    strip: ["OPENAI_API_KEY"],
    login: ["login"],
    dir: (v) => ["--add-dir", v],
    instructions: (acc) => join(acc.home || join(HOME, ".codex"), "AGENTS.md"),
    chat: (p, ctx) => (p ? [inline(p, ctx)] : []),
    headless: (p, edits, ctx) => ["exec", "--skip-git-repo-check", "-s", edits ? "workspace-write" : "read-only", inline(p, ctx)],
    status: async (acc) => {
      const r = await capture("codex", ["login", "status"], acc);
      const line = (r.out + r.err).trim().split("\n").pop() || "";
      return { ok: r.code === 0 && /logged in/i.test(line), detail: r.code === 0 ? line.replace(/^Logged in using /i, "") : "sem login" };
    },
  },
  gemini: {
    name: "Gemini", bin: "gemini", homeVar: "GEMINI_CLI_HOME",
    strip: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    login: [],
    dir: (v) => ["--include-directories", v],
    instructions: (acc) => join(acc.home || HOME, ".gemini", "GEMINI.md"),
    chat: (p, ctx) => (p ? ["-i", inline(p, ctx)] : []),
    headless: (p, edits, ctx) => ["-p", inline(p, ctx), ...(edits ? ["--approval-mode", "auto_edit"] : [])],
    status: async (acc) => {
      const dir = join(acc.home || HOME, ".gemini");
      const env = envFor(acc);
      if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return { ok: true, detail: "API key" };
      if (!fileExists(join(dir, "oauth_creds.json"))) return { ok: false, detail: "sem login" };
      return { ok: true, detail: readJson(join(dir, "google_accounts.json"))?.active || "Google" };
    },
  },
  grok: {
    name: "Grok", bin: "grok", homeVar: "GROK_HOME",
    strip: ["XAI_API_KEY"],
    login: ["login"],
    dir: () => [],
    instructions: (acc) => join(acc.home || join(HOME, ".grok"), "AGENTS.md"),
    chat: (p, ctx) => (p ? [inline(p, ctx)] : []),
    headless: (p, edits, ctx) => ["-p", inline(p, ctx), ...(edits ? [] : ["--deny", "Edit"])],
    status: async (acc) => {
      if (envFor(acc).XAI_API_KEY) return { ok: true, detail: "API key" };
      return fileExists(join(acc.home || join(HOME, ".grok"), "auth.json"))
        ? { ok: true, detail: "logado" } : { ok: false, detail: "sem login" };
    },
  },
};

const binPath = (provider: string) => Bun.which(PROVIDERS[provider].bin, { PATH: ENV_PATH });

function envFor(acc: Account): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // não vazar o contexto de uma sessão Claude Code que tenha lançado o servidor
    if (v == null || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
    // nem o que é só deste servidor: um agente que suba outra Revoada (ou rode os testes dela)
    // herdaria a pasta de dados, a página instalada e a porta desta
    if (k.startsWith("REVOADA_") || k === "PORT") continue;
    env[k] = v;
  }
  env.PATH = ENV_PATH;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  const p = PROVIDERS[acc.provider];
  if (acc.home) {
    for (const k of p.strip) delete env[k];
    env[p.homeVar] = acc.home;
  }
  // sem terminal o Gemini recusa pasta "não confiável"; aqui a pasta foi escolhida pelo usuário no painel
  if (acc.provider === "gemini") env.GEMINI_CLI_TRUST_WORKSPACE = "true";
  return Object.assign(env, acc.env || {});
}

function readJsonText(s: string) {
  const i = s.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i)); } catch { return null; }
}

async function capture(provider: string, args: string[], acc: Account, timeoutMs = 10_000) {
  const bin = binPath(provider);
  if (!bin) return { code: 127, out: "", err: "CLI não instalado" };
  const proc = Bun.spawn([bin, ...args], { env: envFor(acc), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { code, out, err };
}

const stripAnsi = (s: string) => s
  .replace(/\x1b\[\d*C/g, " ")
  .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g, "");

// ---------- limite e rodízio ----------
type Limit = { until: number; reason: string; at: number };
let limits: Record<string, Limit> = readJson(LIMITS_FILE) || {};
const settings: { rotate: boolean; teach: boolean; onboarded: boolean; autoClean: boolean; importChats: boolean; keepAwake: boolean; lidAwake: boolean; lidFreeze: boolean; autoReview: boolean; autoRead: boolean; suggest: boolean; shareTools: boolean; tidyBrain: boolean; remote: boolean; remoteSend: boolean } = { autoRead: true, suggest: true, shareTools: false, tidyBrain: false, rotate: true, teach: false, onboarded: false, autoClean: false, importChats: false, keepAwake: true, lidAwake: false, lidFreeze: false, autoReview: false, remote: false, remoteSend: false, ...(readJson(SETTINGS_FILE) || {}) };
// o que a janela nativa informa sobre a vigília (só existe no app desktop)
let vigil: Record<string, unknown> | null = null;
// consumo de cada conta nas janelas do provedor (5h, 7 dias), lido do que o próprio CLI informa
const usage: Record<string, Usage[]> = readJson(join(ROOT, "usage.json")) || {};
const liveUsage = (id: string) => (usage[id] || []).filter((u) => u.resetsAt > Date.now());
const usedPct = (id: string) => Math.max(0, ...liveUsage(id).map((u) => u.pct));
function setUsage(id: string, windows: Usage[]) {
  if (!windows.length) return;
  usage[id] = windows;
  writeFileSync(join(ROOT, "usage.json"), JSON.stringify(usage));
}
// o Codex grava o consumo no arquivo da sessão: o último registro vale
function readCodexUsage(acc: Account, sessionId: string) {
  try {
    const dir = join(acc.home || join(HOME, ".codex"), "sessions");
    const file = [...new Bun.Glob(`**/rollout-*${sessionId}.jsonl`).scanSync({ cwd: dir, absolute: true })][0];
    if (!file) return;
    const line = readFileSync(file, "utf8").split("\n").reverse().find((l) => l.includes('"rate_limits"'));
    const rl = line && JSON.parse(line).payload?.rate_limits;
    if (!rl) return;
    setUsage(acc.id, [rl.primary, rl.secondary].filter(Boolean).map((w: any) => ({ key: w.window_minutes <= 300 ? "five_hour" : "seven_day", pct: Math.round(w.used_percent || 0), resetsAt: (w.resets_at || 0) * 1000 })));
  } catch {}
}
const lastUsed: Record<string, number> = {};
const activeLimit = (id: string) => (limits[id] && limits[id].until > Date.now() ? limits[id] : null);

function limitUntil(text: string) {
  const now = Date.now();
  let m = text.match(/(?:try again|resets?|available(?: again)?) in\s+(?:(\d+)\s*d(?:ays?)?,?\s*)?(?:(\d+)\s*h(?:ours?|rs?)?,?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i);
  if (m && (m[1] || m[2] || m[3])) return now + ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 60_000;
  m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m) {
    const d = new Date();
    d.setHours((+m[1] % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0), +(m[2] || 0), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return now + DEFAULT_COOLDOWN_MS;
}

function markLimited(acc: Account, text: string, re: RegExp) {
  const line = text.split(/\r?\n/).find((l) => re.test(l)) || "";
  limits[acc.id] = { until: limitUntil(text), reason: line.trim().replace(/\s+/g, " ").slice(0, 160), at: Date.now() };
  writeFileSync(LIMITS_FILE, JSON.stringify(limits, null, 2));
}

// próxima conta do provedor: logada, fora do limite e com mais folga; no empate, a usada há mais tempo
function pickAccount(provider: string, skip: string[]) {
  return accounts
    .filter((a) => a.provider === provider && !skip.includes(a.id) && statusCache.get(a.id)?.ok && !activeLimit(a.id) && usedPct(a.id) < 99)
    .sort((a, b) => Math.round(usedPct(a.id) / 10) - Math.round(usedPct(b.id) / 10) || (lastUsed[a.id] || 0) - (lastUsed[b.id] || 0))[0];
}

// ---------- contas ----------
function loadAccounts(): Account[] {
  const saved: Account[] = readJson(ACCOUNTS_FILE) || [];
  // a conta já logada na máquina entra como perfil padrão (sem diretório isolado)
  for (const provider of Object.keys(PROVIDERS)) {
    if (!saved.some((a) => a.id === `${provider}-padrao`)) {
      saved.push({ id: `${provider}-padrao`, provider, label: "padrão desta máquina", home: null });
    }
  }
  return saved;
}
let accounts = loadAccounts();
function saveAccounts() {
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  chmodSync(ACCOUNTS_FILE, 0o600);
}
saveAccounts();
const account = (id: string) => accounts.find((a) => a.id === id);

// ---------- skills e MCP em todas as contas ----------
const tools = createTools({ home: HOME, root: ROOT });
const extraArgs = (acc: { id: string; provider: string; home: string | null }) => (settings.shareTools ? tools.mcpArgs(acc) : []);
function shareTools(on: boolean) {
  const out = { linked: 0, removed: 0 };
  for (const a of accounts) {
    if (!a.home) continue;
    try { if (on) { const r = tools.syncSkills(a); out.linked += r.linked; out.removed += r.removed; } else out.removed += tools.unlinkSkills(a); }
    catch (e) { console.error(`skills: ${a.id}:`, e); }
  }
  return out;
}

const settingsEarly: { vault?: string } = readJson(join(ROOT, "settings.json")) || {};
const brain = createBrain({
  home: HOME,
  rulesFile: join(ROOT, "brain-rules.json"),
  projects: PROJECTS,
  cacheDir: ROOT,
  vault: process.env.REVOADA_VAULT || settingsEarly.vault || join(HOME, "revoada-cerebro"),
  claudeHomes: () => [{ dir: join(HOME, ".claude"), tag: "" }, ...accounts.filter((a) => a.provider === "claude" && a.home).map((a) => ({ dir: a.home!, tag: ` (${a.label})` }))],
  codexHomes: () => [{ dir: join(HOME, ".codex"), tag: "" }, ...accounts.filter((a) => a.provider === "codex" && a.home).map((a) => ({ dir: a.home!, tag: ` (${a.label})` }))],
});

// ---------- ensinar os agentes a usar o cérebro ----------
// Um bloco marcado no arquivo de instruções globais de cada conta. Só o trecho entre
// os marcadores é nosso; o resto do arquivo é do usuário e não é tocado.
const TEACH_START = "<!-- revoada:cerebro:inicio -->";
const TEACH_END = "<!-- revoada:cerebro:fim -->";
const TEACH_RE = new RegExp(`\\n*${TEACH_START}[\\s\\S]*?${TEACH_END}\\n*`);
const teachBlock = (provider: string) => `${TEACH_START}
## Cérebro compartilhado (revoada)

Esta máquina tem uma memória compartilhada entre todos os agentes (Claude, Codex, Gemini, Grok): um cofre do Obsidian em \`${brain.vault}\`.

**Consultar:** antes de assumir algo sobre o usuário, os projetos ou decisões passadas, procure no cofre. \`Cérebro.md\` é o índice; busque por palavra em \`Agentes/\`, \`Projetos/\` e \`Revoada/\`.

**Salvar, sem esperar pedido:** quando aprender algo durável nesta conversa, crie uma nota em \`${join(brain.vault, "Revoada")}/\`. Vale salvar: preferência ou correção do usuário, decisão tomada e o porquê, como algo funciona de verdade (deploy, comando, armadilha), estado de um projeto que outra sessão vai precisar. Não vale: o que o repositório já registra, andamento da tarefa atual, nada que você não tenha verificado.

**Formato:** um fato por arquivo, nome curto em kebab-case (ex.: \`preferencia-de-commits.md\`). Se a nota já existe, atualize em vez de duplicar.

\`\`\`markdown
---
name: preferencia-de-commits
description: uma linha que diga quando esta nota importa
agente: ${provider}
data: AAAA-MM-DD
---
O fato. **Por quê:** o motivo. **Como aplicar:** quando e onde vale. Ligue notas relacionadas com [[nome-da-nota]].
\`\`\`

**Privado:** finanças e infraestrutura do usuário não saem desta máquina. Nunca salve senha, token, chave de API, dado financeiro ou de infraestrutura (IP, id de servidor, credencial), e não cite nem copie notas desses temas mesmo que estejam no cofre. Não edite \`Agentes/\` nem \`Projetos/\`: são espelho da memória de cada agente e a sincronização sobrescreve.
${TEACH_END}`;

const isTaught = (acc: Account) => { try { return readFileSync(PROVIDERS[acc.provider].instructions(acc), "utf8").includes(TEACH_START); } catch { return false; } };
function teach(acc: Account, on: boolean) {
  const file = PROVIDERS[acc.provider].instructions(acc);
  let cur = "";
  try { cur = readFileSync(file, "utf8"); } catch {}
  const rest = cur.replace(TEACH_RE, "\n").trim();
  const next = on ? (rest ? rest + "\n\n" : "") + teachBlock(acc.provider) + "\n" : rest ? rest + "\n" : "";
  if (next === cur) return;
  if (!on && !cur) return;
  // cópia do original na primeira vez que mexemos num arquivo que já tinha conteúdo
  if (cur.trim() && !cur.includes(TEACH_START) && !existsSync(file + ".antes-da-revoada")) writeFileSync(file + ".antes-da-revoada", cur);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, next);
}
const teachAll = (on: boolean) => { for (const a of accounts) if (binPath(a.provider) || isTaught(a)) teach(a, on); };

function openInObsidian() {
  if (!existsSync("/Applications/Obsidian.app")) throw new Error("Obsidian não está instalado em /Applications");
  // o Obsidian só abre por link um cofre que ele já conhece
  const dir = join(HOME, "Library/Application Support/obsidian");
  const cfg = readJson(join(dir, "obsidian.json")) || {};
  cfg.vaults ||= {};
  if (!Object.values<any>(cfg.vaults).some((v) => v.path === brain.vault)) {
    mkdirSync(dir, { recursive: true });
    cfg.vaults[crypto.randomUUID().replace(/-/g, "").slice(0, 16)] = { path: brain.vault, ts: Date.now() };
    writeFileSync(join(dir, "obsidian.json"), JSON.stringify(cfg));
  }
  Bun.spawn(["open", `obsidian://open?path=${encodeURIComponent(brain.vault)}`]);
}

const statusCache = new Map<string, Status>();
const statusPending = new Map<string, Promise<void>>();
function refreshStatus(acc: Account) {
  if (statusPending.has(acc.id)) return statusPending.get(acc.id)!;
  const p = (async () => {
    let s: { ok: boolean; detail: string };
    if (!binPath(acc.provider)) s = { ok: false, detail: "CLI não instalado" };
    else { try { s = await PROVIDERS[acc.provider].status(acc); } catch (e) { s = { ok: false, detail: String(e) }; } }
    statusCache.set(acc.id, { ...s, at: Date.now() });
    statusPending.delete(acc.id);
  })();
  statusPending.set(acc.id, p);
  return p;
}

function parseEnv(text: string) {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ---------- sessões interativas (PTY) ----------
type Session = {
  id: string; accountId: string; kind: "chat" | "login"; cwd: string; startedAt: number;
  alive: boolean; exitCode: number | null; proc: any; buf: Uint8Array[]; size: number; clients: Set<any>;
  tail: string; limitHit: boolean; rotatedFrom: string | null; title: string; brain: string[];
  lastOut: number; // última vez que o agente escreveu na tela: é o sinal de que está trabalhando
};
const BUSY_MS = 5000;
type SessionOpts = { prompt?: string; ctx?: string; title?: string; brain?: string[]; cols?: number; rows?: number };
const sessions = new Map<string, Session>();
const enc = new TextEncoder();
const dec = new TextDecoder();

function pushOutput(s: Session, data: Uint8Array) {
  const chunk = data.slice();
  s.buf.push(chunk);
  s.size += chunk.length;
  s.lastOut = Date.now();
  while (s.size > SCROLLBACK_BYTES && s.buf.length > 1) s.size -= s.buf.shift()!.length;
  for (const ws of s.clients) ws.send(chunk);
  if (s.kind === "chat" && !s.limitHit) {
    s.tail = (s.tail + dec.decode(chunk)).slice(-1200);
    const plain = stripAnsi(s.tail);
    if (LIMIT_STRICT_RE.test(plain)) { s.limitHit = true; onSessionLimit(s, plain); }
  }
}

function onSessionLimit(s: Session, text: string) {
  const acc = account(s.accountId);
  if (!acc) return;
  markLimited(acc, text, LIMIT_STRICT_RE);
  if (!settings.rotate) return;
  const next = pickAccount(acc.provider, [acc.id]);
  const note = (msg: string) => pushOutput(s, enc.encode(`\r\n\x1b[33m[revoada] ${msg}\x1b[0m\r\n`));
  if (!next) return note("Conta no limite e não há outra conta pronta deste provedor.");
  startSession(next, "chat", s.cwd, { title: s.title }).rotatedFrom = s.id;
  note(`Conta no limite. Abri uma sessão nova em "${next.label}", na mesma pasta. O contexto desta conversa não vai junto.`);
}

function startSession(acc: Account, kind: "chat" | "login", cwd: string, o: SessionOpts = {}): Session {
  const bin = binPath(acc.provider);
  if (!bin) throw new Error(`${PROVIDERS[acc.provider].name}: CLI não instalado`);
  if (acc.home) mkdirSync(acc.home, { recursive: true });
  const s: Session = {
    id: crypto.randomUUID().slice(0, 8), accountId: acc.id, kind, cwd, startedAt: Date.now(),
    alive: true, exitCode: null, proc: null, buf: [], size: 0, clients: new Set(),
    tail: "", limitHit: false, rotatedFrom: null,
    title: o.title || (kind === "login" ? "Login" : "Sessão"), brain: o.brain || [], lastOut: Date.now(),
  };
  lastUsed[acc.id] = Date.now();
  s.proc = Bun.spawn([bin, ...(kind === "login" ? PROVIDERS[acc.provider].login : PROVIDERS[acc.provider].chat(o.prompt || "", o.ctx)), ...(kind === "chat" ? [...extraArgs(acc), ...PROVIDERS[acc.provider].dir(brain.vault)] : [])], {
    cwd, env: envFor(acc),
    terminal: { cols: o.cols || 100, rows: o.rows || 30, data: (_t: unknown, data: Uint8Array) => pushOutput(s, data) },
  });
  s.proc.exited.then((code: number) => {
    s.alive = false;
    s.exitCode = code;
    pushOutput(s, enc.encode(`\r\n\x1b[2m[sessão encerrada, código ${code}]\x1b[0m\r\n`));
    statusCache.delete(acc.id);
    refreshStatus(acc);
    archive(s);
    // trabalho terminou: boa hora de ver se sobrou cópia que já virou PR
    setTimeout(autoClean, 5000);
  });
  sessions.set(s.id, s);
  return s;
}

// sessão encerrada vira histórico: a tela fica em disco pra reabrir a conversa depois
const sessionMeta = (s: Session) => ({ id: s.id, accountId: s.accountId, kind: s.kind, cwd: s.cwd, startedAt: s.startedAt, exitCode: s.exitCode, title: s.title, brain: s.brain, limitHit: s.limitHit, rotatedFrom: s.rotatedFrom });
function archive(s: Session) {
  if (s.kind === "chat" && s.size) writeFileSync(join(HISTORY, `${s.id}.bin`), Buffer.concat(s.buf));
  const past = [...sessions.values()].filter((x) => !x.alive && x.kind === "chat").sort((a, b) => b.startedAt - a.startedAt);
  for (const old of past.slice(MAX_HISTORY)) { sessions.delete(old.id); rmSync(join(HISTORY, `${old.id}.bin`), { force: true }); }
  writeFileSync(HISTORY_FILE, JSON.stringify(past.slice(0, MAX_HISTORY).map(sessionMeta)));
}
for (const m of (readJson(HISTORY_FILE) || []) as any[]) {
  sessions.set(m.id, { ...m, alive: false, proc: null, buf: [], size: 0, clients: new Set(), tail: "", lastOut: 0 });
}

// ---------- cópia de trabalho isolada por tarefa ----------
// caminho real: é assim que o git lista as cópias, e os dois precisam bater
const WORKTREES = join(realpathSync(ROOT), "worktrees");
type Worktree = { main: string; path: string; branch: string };
async function git(cwd: string, ...args: string[]) {
  try {
    const p = Bun.spawn(["git", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { ok: code === 0, out: out.trim(), err: err.trim() };
  } catch (e) { return { ok: false, out: "", err: String(e) }; }
}
async function repoInfo(cwd: string) {
  const top = await git(cwd, "rev-parse", "--show-toplevel");
  if (!top.ok) return null;
  return { root: top.out, branch: (await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).out };
}
async function makeWorktree(cwd: string, title: string): Promise<Worktree & { cwd: string }> {
  const info = await repoInfo(cwd);
  if (!info) throw new Error("esta pasta não é um repositório git; não dá pra isolar");
  const slug = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "tarefa";
  const name = `${slug}-${crypto.randomUUID().slice(0, 4)}`;
  const path = join(WORKTREES, basename(info.root), name), branch = `revoada/${name}`;
  mkdirSync(dirname(path), { recursive: true });
  const r = await git(info.root, "worktree", "add", "-b", branch, path);
  if (!r.ok) throw new Error(`não consegui criar a cópia isolada: ${r.err.split("\n").pop()}`);
  // o git devolve o caminho real; a pasta pedida pode ter vindo por um atalho (/tmp, /var)
  const sub = relative(info.root, realpathSync(cwd));
  return { main: info.root, path, branch, cwd: sub ? join(path, sub) : path };
}
// a cópia sai sozinha quando fica limpa; se a conversa continuar, ela volta do branch
async function restoreWorktree(wt: Worktree) {
  if (existsSync(wt.path)) return;
  await git(wt.main, "worktree", "prune");
  for (const args of [["worktree", "add", wt.path, wt.branch], ["worktree", "add", "--track", "-b", wt.branch, wt.path, `origin/${wt.branch}`], ["worktree", "add", "-b", wt.branch, wt.path]]) {
    if ((await git(wt.main, ...args)).ok) return;
  }
  throw new Error("a cópia isolada desta conversa foi removida e não consegui recriar");
}

// o que mudou numa pasta de trabalho. Numa cópia isolada interessa tudo desde que ela se separou
// da principal, com commit ou sem.
async function workDiff(dir: string, main?: string | null) {
  const info = await repoInfo(dir);
  if (!info) return null;
  let base = "HEAD";
  if (main) { const head = (await git(main, "rev-parse", "HEAD")).out; const mb = (await git(dir, "merge-base", "HEAD", head)).out; if (mb) base = mb; }
  const [status, patch, commits] = await Promise.all([git(dir, "status", "--porcelain"), git(dir, "diff", base), base === "HEAD" ? Promise.resolve({ out: "" }) : git(dir, "log", "--oneline", `${base}..HEAD`)]);
  return { branch: info.branch, root: info.root, files: status.out ? status.out.split("\n") : [], commits: commits.out ? commits.out.split("\n") : [], patch: patch.out };
}

// ---------- revisão cruzada ----------
const REVIEW_PATCH_CHARS = 60_000;
const REVIEW_NEW_FILES = 20;
// quem revisa: de preferência outro provedor (outro modelo erra em lugares diferentes);
// sem outro provedor pronto, outra conta do mesmo; em último caso a mesma conta, em sessão nova
function pickReviewer(c: { provider: string; accountId: string | null }, target?: string) {
  if (target) return target.startsWith("pool:") ? pickAccount(target.slice(5), []) : accounts.find((a) => a.id === target && statusCache.get(a.id)?.ok && !activeLimit(a.id));
  for (const p of ["codex", "claude", "gemini", "grok"]) { if (p === c.provider) continue; const a = pickAccount(p, []); if (a) return a; }
  return pickAccount(c.provider, c.accountId ? [c.accountId] : []) || pickAccount(c.provider, []);
}
async function startReview(c: NonNullable<ReturnType<typeof convos.get>>, target?: string, kind?: "security") {
  if (c.working) throw new Error("o agente ainda está respondendo");
  // a auditoria de segurança não precisa de diff: sem mudança (ou sem git) o alvo é o projeto como está
  const d = (await workDiff(c.cwd, c.worktree?.main)) || (kind ? { files: [] as string[], commits: [] as string[], patch: "" } : null);
  if (!d) throw new Error("esta pasta não é um repositório git; não há mudança para revisar");
  // arquivo novo ainda fora do git não aparece no diff: entra como arquivo inteiro
  let patch = d.patch;
  const fresh = (await repoInfo(c.cwd)) ? (await git(c.cwd, "ls-files", "--others", "--exclude-standard")).out.split("\n").filter(Boolean) : [];
  for (const f of fresh.slice(0, REVIEW_NEW_FILES)) {
    if (patch.length > REVIEW_PATCH_CHARS) break;
    try { if (statSync(join(c.cwd, f)).size > 40_000) continue; } catch { continue; }
    patch += "\n" + (await git(c.cwd, "diff", "--no-index", "--", "/dev/null", f)).out;
  }
  if (!patch.trim() && !kind) throw new Error("nada mudou nos arquivos desta conversa; não há o que revisar");
  await Promise.all(accounts.filter((a) => !statusCache.has(a.id)).map(refreshStatus));
  const acc = pickReviewer(c, target);
  if (!acc) throw new Error("nenhuma conta pronta para revisar");
  lastUsed[acc.id] = Date.now();
  convos.review(c, { acc, patch: patch.slice(0, REVIEW_PATCH_CHARS), files: [...d.files.map((f) => f.slice(3)), ...d.commits.map((x) => `commit ${x}`)], truncated: patch.length > REVIEW_PATCH_CHARS, kind });
  return acc;
}

// ---------- conversas (modo estruturado dos CLIs) ----------
const accName = (a?: { provider: string; label: string }) => (a ? `${PROVIDERS[a.provider].name} · ${a.label}` : "conta removida");
const ATTACH = join(ROOT, "attachments");
const TITLES = join(ROOT, "titles"); // pasta neutra onde roda o pedido de título
mkdirSync(ATTACH, { recursive: true });
mkdirSync(TITLES, { recursive: true });
// título curto pela conta Claude que estiver pronta, no modelo mais barato; sem Claude, fica a primeira linha
async function makeTitle(c: { messages: any[] }): Promise<string | null> {
  const acc = pickAccount("claude", []), bin = binPath("claude");
  if (!acc || !bin) return null;
  const ask = String(c.messages[0]?.text || "").slice(0, 700);
  const said = (c.messages[1]?.items || []).filter((i: any) => i.kind === "text").map((i: any) => i.text).join(" ").slice(0, 400);
  const proc = Bun.spawn([bin, "-p", `Dê um título para a conversa abaixo: no máximo 6 palavras, em português, sem aspas e sem ponto final. Responda só com o título.\n\nPedido: ${ask}\n\nComeço da resposta: ${said}`, "--model", "haiku"], { cwd: TITLES, env: envFor(acc), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 45_000);
  const out = (await new Response(proc.stdout).text()).trim();
  clearTimeout(timer);
  const title = out.split("\n").pop()!.replace(/^["'“]|["'”.]$/g, "").trim();
  return (await proc.exited) === 0 && title && title.length <= 70 ? title : null;
}
// Próxima mensagem provável, no modelo mais barato do Claude. É o que o campo oferece quando o agente
// termina: Tab aceita, Enter manda. Sem conta Claude pronta, não há sugestão.
async function makeSuggestion(c: { messages: any[] }): Promise<string | null> {
  if (!settings.suggest) return null;
  const acc = pickAccount("claude", []), bin = binPath("claude");
  if (!acc || !bin) return null;
  const last = c.messages.at(-1), ask = [...c.messages].reverse().find((m) => m.role === "user");
  const said = (last?.items || []).filter((i: any) => i.kind === "text").map((i: any) => i.text).join("\n").slice(-1500);
  if (!said.trim()) return null;
  const proc = Bun.spawn([bin, "-p", `Abaixo está o fim de uma conversa entre um usuário e um agente de código. Escreva a próxima mensagem que o usuário mais provavelmente mandaria agora: uma linha só, no máximo 12 palavras, na voz dele (direta, informal, em português), específica ao que acabou de acontecer. Se a resposta terminou com uma pergunta ou uma oferta, responda a ela. Sem aspas e sem ponto final. Se não houver um próximo passo óbvio, responda só com um traço: -\n\nÚltimo pedido do usuário: ${String(ask?.text || "").slice(0, 500)}\n\nFim da resposta do agente:\n${said}`, "--model", "haiku"], { cwd: TITLES, env: envFor(acc), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 45_000);
  const out = (await new Response(proc.stdout).text()).trim();
  clearTimeout(timer);
  const line = (out.split("\n").pop() || "").replace(/^["'“]|["'”.]$/g, "").trim();
  return (await proc.exited) === 0 && line.length > 2 && line.length <= 120 && !/^[-–—]+$/.test(line) ? line : null;
}
const convos = createConvos({
  dir: join(ROOT, "convos"), vault: brain.vault, attachDir: ATTACH,
  onUsage: (a, w) => setUsage(a.id, w),
  afterTurn: (a, sid) => { if (a.provider === "codex") readCodexUsage(a as Account, sid); },
  makeTitle,
  suggest: makeSuggestion,
  extraArgs,
  account: (id) => (id ? account(id) : undefined),
  accName,
  binPath,
  envFor: (a) => envFor(a as Account),
  pick: (provider, skip) => { const a = pickAccount(provider, skip); if (a) lastUsed[a.id] = Date.now(); return a; },
  isReady: (a) => !!statusCache.get(a.id)?.ok && !activeLimit(a.id),
  markLimited: (a, text) => markLimited(a as Account, text, LIMIT_RE),
  limitRe: LIMIT_RE, strictRe: LIMIT_STRICT_RE, rotate: () => settings.rotate,
  brainContext: (q, hint) => brain.context(q, hint),
  onIdle: () => setTimeout(autoClean, 5000),
  prepare: async (c) => { if (c.worktree) await restoreWorktree(c.worktree); },
  autoAllow: (tool, input) => settings.autoRead && readOnlyTool(tool, input),
  // revisão automática: só quando a resposta mexeu em arquivo, e nunca revisão de revisão
  afterDone: (c, msg) => {
    if (!settings.autoReview || msg.review || !msg.items?.some((i) => i.kind === "files")) return;
    startReview(c).catch(() => {});
  },
});
// modelo e esforço vindos da página: texto válido fica, null ou vazio limpa a escolha, o resto é ignorado
const asModel = (m: unknown) => (m === null || m === "" ? null : validModel(m) ? m : undefined);
const asEffort = (e: unknown) => (e === null || e === "" ? null : typeof e === "string" && Object.values(EFFORTS).some((l) => l.includes(e)) ? e : undefined);
const asMode = (m: unknown): Mode => (m === "read" || m === "full" || m === "ask" ? m : "edit");
// só aceita anexo que este servidor gravou
const asAttachments = (list: unknown): Attachment[] => (Array.isArray(list) ? list : []).filter((a) => a && typeof a.path === "string" && a.path.startsWith(ATTACH + "/") && existsSync(a.path)).slice(0, 10);

// ---------- conversas que já existem nos outros programas ----------
const history = createHistory({
  homes: () => accounts.filter((a) => a.provider === "claude" || a.provider === "codex").map((a) => ({ provider: a.provider, accountId: a.id, dir: a.home || join(HOME, a.provider === "claude" ? ".claude" : ".codex") })),
  skipCwd: (cwd) => cwd === TITLES || cwd.startsWith(ROOT + "/") || cwd.startsWith("/private/tmp/") || cwd.startsWith("/tmp/"),
  known: () => new Set(convos.natives()),
});

// ---------- acompanhar pelo celular ----------
const remote = createRemote({
  port: REMOTE_PORT, file: join(ROOT, "remote.json"), publicDir: PUBLIC,
  accounts: () => accounts.filter((a) => statusCache.get(a.id)?.ok).map((a) => ({ name: accName(a), ok: true, limitUntil: activeLimit(a.id)?.until || null, usage: liveUsage(a.id).map((u) => ({ key: u.key, pct: u.pct })) })),
  accName: (id) => accName(id ? account(id) : undefined),
  convos: () => convos.list().map((c) => ({ id: c.id, title: c.title, cwd: c.cwd, at: c.at, working: c.working, waiting: c.waiting, accountId: c.accountId })),
  convo: (id) => convos.get(id),
  decide: (id, req, allow) => convos.decide(id, req, allow ? "allow" : "deny"),
  stop: (id) => convos.stop(id),
  send: (c, text) => convos.send(c, text),
  canSend: () => settings.remoteSend,
});
function applyRemote() {
  try { settings.remote ? remote.start() : remote.stop(); }
  catch (e: any) { settings.remote = false; throw new Error(`não consegui abrir a porta ${REMOTE_PORT}: ${e?.message || e}`); }
}

// ---------- pedidos agendados ----------
const isTarget = (t: unknown): t is string => typeof t === "string" && (t.startsWith("pool:") ? !!PROVIDERS[t.slice(5)] : !!account(t));
async function openChat(o: { prompt: string; target: string; cwd: string; mode: Mode; brain: boolean; isolate: boolean; title?: string }) {
  const cwd = validCwd(o.cwd);
  if (!cwd) throw new Error("a pasta deste pedido não existe mais");
  if (!isTarget(o.target)) throw new Error("a conta deste pedido não existe mais");
  await Promise.all(accounts.filter((a) => !statusCache.has(a.id)).map(refreshStatus));
  const wt = o.isolate ? await makeWorktree(cwd, o.title || o.prompt) : undefined;
  const c = convos.create({ prompt: o.prompt, target: o.target, cwd: wt?.cwd || cwd, mode: o.mode, brain: o.brain, worktree: wt && { main: wt.main, path: wt.path, branch: wt.branch } });
  if (o.title) convos.rename(c.id, o.title);
  return c;
}
const schedules = createSchedules({
  file: join(ROOT, "schedules.json"),
  run: async (s) => (await openChat({ prompt: s.prompt, target: s.target, cwd: s.cwd, mode: asMode(s.mode), brain: s.brain, isolate: s.isolate })).id,
});

// ---------- supervisor ----------
const missions = createMissions({
  file: join(ROOT, "missions.json"),
  plan: (m) => {
    const c = convos.create({ prompt: PLAN_PROMPT(m.prompt), target: m.planner, cwd: m.cwd, mode: "read", brain: true });
    convos.rename(c.id, `Plano: ${m.prompt.split("\n")[0].slice(0, 60)}`);
    return c.id;
  },
  launch: async (m, t, worker) => {
    const c = await openChat({ prompt: `${t.prompt}\n\nQuando terminar, faça commit de todo o trabalho neste branch (sem push).`, target: worker, cwd: m.cwd, mode: "edit", brain: true, isolate: true, title: t.title });
    return { convo: c.id, branch: c.worktree?.branch };
  },
  convo: (id) => {
    const c = convos.get(id);
    if (!c) return null;
    const last = c.messages.at(-1);
    return {
      working: c.working, lastState: last?.state, error: last?.error, branch: c.worktree?.branch,
      text: (last?.items || []).filter((i) => i.kind === "text").map((i: any) => i.text).join("\n"),
      touchedFiles: c.messages.some((x) => !x.review && x.items?.some((i) => i.kind === "files")),
    };
  },
  // a revisão automática dos ajustes pode ter chegado antes: uma revisão por tarefa basta
  review: async (id) => { const c = convos.get(id); if (c && !c.working && !c.messages.some((x) => x.review)) await startReview(c); },
  merge: async (m, branches) => (await openChat({
    prompt: `Junte neste branch o trabalho dos branches abaixo, um por vez, com git merge. Resolva os conflitos preservando a intenção de cada tarefa, rode os testes do projeto e conserte o que a junção quebrar. No fim, faça commit e diga o que entrou e o que ficou pendente.\n\nPedido original:\n${m.prompt}\n\nBranches:\n${branches.map((b) => `- ${b.branch} (${b.title})`).join("\n")}`,
    target: m.planner, cwd: m.cwd, mode: "edit", brain: true, isolate: true, title: `Juntar: ${m.prompt.split("\n")[0].slice(0, 50)}`,
  })).id,
});

// ---------- cópias de repositório deixadas pelos agentes ----------
const clones = createClones({
  home: HOME,
  roots: [PROJECTS],
  extra: [".codex/worktrees", ".cursor/worktrees", ".claude/worktrees", ".claude-worktrees"].map((d) => join(HOME, d)),
  managedRoot: WORKTREES,
  inUse: (path) => convos.inUse(path) || [...sessions.values()].some((s) => s.alive && (s.cwd === path || s.cwd.startsWith(path + "/"))) || runs.some((r) => r.jobs.some((j) => j.state === "rodando") && (r.cwd === path || r.cwd.startsWith(path + "/"))),
});
let cleaned: { at: number; count: number; freedKb: number; names: string[] } | null = null;
let cleaning = false;
async function autoClean() {
  if (cleaning) return;
  cleaning = true;
  try {
    const done = await clones.autoClean(settings.autoClean);
    if (done.length) cleaned = { at: Date.now(), count: done.length, freedKb: done.reduce((n, c) => n + c.sizeKb, 0), names: done.map((c) => c.name) };
  } finally { cleaning = false; }
}
setInterval(autoClean, AUTO_CLEAN_EVERY_MS);

// ---------- disparo (um prompt, várias contas, sem TTY) ----------
type Job = {
  cwd?: string; worktree?: Worktree; // com isolamento, cada resposta trabalha na própria cópia
  target: string; provider: string; pool: boolean; accountId: string | null;
  state: "rodando" | "ok" | "erro" | "cancelado"; out: string; err: string; code: number | null;
  startedAt: number; endedAt: number | null; tried: string[]; trail: { accountId: string; reason: string }[]; proc?: any;
};
type Run = { id: string; prompt: string; ctx?: string; brain: string[]; cwd: string; edits: boolean; at: number; jobs: Job[] };
const publicRun = (r: Run) => ({ ...r, ctx: undefined, jobs: r.jobs.map(({ proc, ...j }) => j) });
const runs: Run[] = (readJson(RUNS_FILE) || []).map((r: Run) => ({ ...r, jobs: r.jobs.map((j) => (j.state === "rodando" ? { ...j, state: "cancelado" } : j)) }));
const saveRuns = () => writeFileSync(RUNS_FILE, JSON.stringify(runs.map(publicRun)));

async function pump(stream: ReadableStream<Uint8Array>, onText: (t: string) => void) {
  const d = new TextDecoder();
  for await (const chunk of stream) onText(d.decode(chunk, { stream: true }));
}

function endJob(job: Job, state: Job["state"], err?: string) {
  if (job.state === "rodando") job.state = state;
  if (err) job.err = err;
  job.endedAt = Date.now();
  saveRuns();
}

function launch(run: Run, job: Job) {
  const acc = job.pool ? pickAccount(job.provider, job.tried) : account(job.accountId!);
  if (!acc) return endJob(job, "erro", job.tried.length ? "Todas as contas deste provedor bateram no limite." : "Nenhuma conta pronta neste provedor.");
  const bin = binPath(acc.provider);
  if (!bin) return endJob(job, "erro", "CLI não instalado");
  job.accountId = acc.id;
  job.tried.push(acc.id);
  lastUsed[acc.id] = Date.now();
  const proc = Bun.spawn([bin, ...PROVIDERS[acc.provider].headless(run.prompt, run.edits, run.ctx), ...extraArgs(acc), ...PROVIDERS[acc.provider].dir(brain.vault)], {
    cwd: job.cwd || run.cwd, env: { ...envFor(acc), TERM: "dumb", NO_COLOR: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  job.proc = proc;
  const timer = setTimeout(() => proc.kill(), JOB_TIMEOUT_MS);
  Promise.all([
    pump(proc.stdout, (t) => (job.out += t)),
    pump(proc.stderr, (t) => (job.err = (job.err + t).slice(-8000))),
    proc.exited,
  ]).then(([, , code]) => {
    clearTimeout(timer);
    job.code = code;
    if (job.state !== "rodando") return endJob(job, job.state);
    const text = stripAnsi(job.out.slice(-3000) + "\n" + job.err.slice(-3000));
    const re = code !== 0 ? LIMIT_RE : LIMIT_STRICT_RE;
    if ((code !== 0 || job.out.length < 400) && re.test(text)) {
      markLimited(acc, text, re);
      if (job.pool && settings.rotate) {
        job.trail.push({ accountId: acc.id, reason: limits[acc.id].reason });
        job.out = job.err = "";
        return launch(run, job);
      }
      return endJob(job, "erro", job.err || "Conta no limite.");
    }
    endJob(job, code === 0 ? "ok" : "erro");
  });
}

// alvo "pool:<provedor>" entra no rodízio; id de conta fica fixo nela
async function startRun(prompt: string, targets: string[], cwd: string, edits: boolean, ctx?: { text: string; notes: string[] } | null, isolate = false): Promise<Run> {
  const run: Run = { id: crypto.randomUUID().slice(0, 8), prompt, ctx: ctx?.text, brain: ctx?.notes || [], cwd, edits, at: Date.now(), jobs: [] };
  for (const target of targets) {
    const pool = target.startsWith("pool:");
    const provider = pool ? target.slice(5) : account(target)?.provider;
    if (!provider || !PROVIDERS[provider]) continue;
    const job: Job = {
      target, provider, pool, accountId: pool ? null : target, state: "rodando", out: "", err: "", code: null,
      startedAt: Date.now(), endedAt: null, tried: [], trail: [],
    };
    run.jobs.push(job);
    if (isolate) {
      try { const wt = await makeWorktree(cwd, `${provider}-${prompt}`); job.cwd = wt.cwd; job.worktree = wt; }
      catch (e: any) { endJob(job, "erro", e.message); continue; }
    }
    launch(run, job);
  }
  runs.unshift(run);
  runs.length = Math.min(runs.length, MAX_RUNS);
  return run;
}

// ---------- http ----------
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

function listDirs() {
  const base = PROJECTS;
  const out: string[] = [HOME, base];
  const sub = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
        .map((d) => join(dir, d.name));
    } catch { return []; }
  };
  for (const d of sub(base)) { out.push(d); out.push(...sub(d)); }
  return out.slice(0, 400);
}

function validCwd(cwd: unknown) {
  const p = typeof cwd === "string" && cwd.trim() ? cwd.trim().replace(/^~(?=\/|$)/, HOME) : HOME;
  try { if (statSync(p).isDirectory()) return p; } catch {}
  return null;
}

async function state(refresh: boolean) {
  const stale = accounts.filter((a) => refresh || !statusCache.has(a.id) || Date.now() - statusCache.get(a.id)!.at > 60_000);
  const pending = stale.map(refreshStatus);
  if (refresh || stale.some((a) => !statusCache.has(a.id))) await Promise.all(pending);
  return {
    home: HOME, projects: PROJECTS,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, installed: !!binPath(id), efforts: EFFORTS[id] || [] })),
    accounts: accounts.map((a) => ({
      id: a.id, provider: a.provider, label: a.label, isolated: !!a.home, envKeys: Object.keys(a.env || {}),
      status: statusCache.get(a.id) || { ok: false, detail: "verificando" },
      limit: activeLimit(a.id), lastUsed: lastUsed[a.id] || null, taught: isTaught(a), usage: liveUsage(a.id),
    })),
    settings,
    sessions: [...sessions.values()].map((s) => ({ ...sessionMeta(s), alive: s.alive, busy: s.alive && Date.now() - s.lastOut < BUSY_MS })),
    runs: runs.map((r) => ({ id: r.id, title: r.prompt, cwd: r.cwd, at: r.at, running: r.jobs.some((j) => j.state === "rodando"), jobs: r.jobs.length })),
    brain: brain.info(),
    clones: clones.summary(), cleaned, vigil, remote: { on: remote.on, port: REMOTE_PORT },
    schedules: schedules.list().length,
    missions: missions.list().map((m) => ({ id: m.id, title: m.prompt.split("\n")[0].slice(0, 80), cwd: m.cwd, at: m.at, state: m.state })),
    convos: convos.list(),
    history: settings.importChats ? history.list() : [],
  };
}

function demoState(real: any) {
  const now = Date.now();
  return { ...real,
    accounts: [
      { id: "c1", provider: "claude", label: "pessoal", status: { ok: true, detail: "" }, limit: { until: now + 82 * 60_000, at: now - 40 * 60_000, reason: "5-hour limit reached" } },
      { id: "c2", provider: "claude", label: "trabalho", status: { ok: true, detail: "" }, limit: null },
      { id: "c3", provider: "claude", label: "cliente", status: { ok: false, detail: "sem login" }, limit: null },
      { id: "x1", provider: "codex", label: "padrão", status: { ok: true, detail: "" }, limit: null },
      { id: "g1", provider: "gemini", label: "Google", status: { ok: true, detail: "" }, limit: null },
    ],
    sessions: [
      { id: "s1", accountId: "c2", kind: "chat", cwd: "/x/git/api", startedAt: now - 134_000, title: "Refatora o parser de CNPJ e roda os testes", alive: true, busy: true },
      { id: "s2", accountId: "x1", kind: "chat", cwd: "/x/git/revoada", startedAt: now - 912_000, title: "Revisa o diff e aponta defeitos reais", alive: true, busy: false },
    ],
    runs: [{ id: "r1", title: "Compara três abordagens de cache", cwd: "/x/git/loja", at: now - 41_000, running: true, jobs: 3 }],
  };
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    // o servidor abre shells: só aceita chamadas da própria página local
    const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
    const origin = req.headers.get("origin");
    if (!hosts.includes(req.headers.get("host") || "") || (origin && !hosts.some((h) => origin === `http://${h}`))) {
      return new Response("forbidden", { status: 403 });
    }
    if (req.method !== "GET" && !origin) return new Response("forbidden", { status: 403 });
    const path = url.pathname;

    if (path === "/ws") {
      const s = sessions.get(url.searchParams.get("session") || "");
      if (!s) return new Response("sessão não existe", { status: 404 });
      return srv.upgrade(req, { data: { sid: s.id } }) ? undefined : new Response("upgrade falhou", { status: 400 });
    }
    if (path === "/" || path === "/index.html") return new Response(Bun.file(join(PUBLIC, "index.html")));
    if (path === "/logo.svg" || path === "/icon.svg") return new Response(Bun.file(join(PUBLIC, path)));
    if (path === "/mini") return new Response(Bun.file(join(PUBLIC, "mini.html")));
    if (path === "/md.js" || path === "/sync.js") return new Response(Bun.file(join(PUBLIC, path)));
    // só em desenvolvimento: estado de mentira pra olhar o painel da barra com tudo aceso
    if (path === "/api/demo-state" && process.env.REVOADA_DEMO) return json(demoState(await state(false)));
    if (path.startsWith("/vendor/")) {
      const f = VENDOR[path.slice(8)];
      return f ? new Response(Bun.file(f)) : new Response("not found", { status: 404 });
    }
    if (!path.startsWith("/api/")) return new Response("not found", { status: 404 });

    // o anexo chega como arquivo cru no corpo; ali não se lê como JSON
    const body: any = req.method === "GET" || req.method === "DELETE" || path === "/api/attach" ? {} : await req.json().catch(() => ({}));
    const [, , resource, id, action, extra] = path.split("/");

    if (resource === "state") return json(await state(url.searchParams.has("refresh")));
    if (resource === "dirs") return json(listDirs());

    // entrada única do campo de pedido: uma conta abre sessão, várias respondem em paralelo
    if (resource === "chat" && req.method === "POST") {
      const prompt = String(body.prompt || "").trim();
      const targets: string[] = Array.isArray(body.targets) ? body.targets : [];
      const cwd = validCwd(body.cwd);
      if (!targets.length) return fail("escolha ao menos uma conta");
      if (!cwd) return fail("pasta não existe");
      await Promise.all(accounts.filter((a) => !statusCache.has(a.id)).map(refreshStatus));
      if (targets.length === 1 && !body.terminal) {
        if (!prompt && !asAttachments(body.attachments).length) return fail("escreva o pedido");
        let wt: (Worktree & { cwd: string }) | undefined;
        if (body.isolate) { try { wt = await makeWorktree(cwd, prompt); } catch (e: any) { return fail(e.message); } }
        return json({ kind: "chat", id: convos.create({ prompt, target: targets[0], cwd: wt?.cwd || cwd, mode: asMode(body.mode), brain: body.brain !== false, worktree: wt && { main: wt.main, path: wt.path, branch: wt.branch }, attachments: asAttachments(body.attachments), model: asModel(body.model), effort: asEffort(body.effort) }).id });
      }
      const ctx = prompt && body.brain !== false ? await brain.context(prompt, cwd.split("/").pop()) : null;
      if (targets.length > 1) {
        if (!prompt) return fail("escreva o pedido para disparar em paralelo");
        return json({ kind: "run", id: (await startRun(prompt, targets, cwd, asMode(body.mode) !== "read", ctx, !!body.isolate)).id });
      }
      const t = targets[0];
      const acc = t.startsWith("pool:") ? pickAccount(t.slice(5), []) : account(t);
      if (!acc) return fail("nenhuma conta pronta para esse pedido");
      try {
        const s = startSession(acc, "chat", cwd, { prompt, ctx: ctx?.text, brain: ctx?.notes, title: prompt.split("\n")[0].slice(0, 80) || "Sessão", cols: body.cols, rows: body.rows });
        return json({ kind: "session", id: s.id });
      } catch (e: any) { return fail(e.message); }
    }

    if (resource === "attach") {
      if (req.method === "GET") {
        const f = join(ATTACH, basename(decodeURIComponent(id || "")));
        return existsSync(f) ? new Response(Bun.file(f)) : new Response("not found", { status: 404 });
      }
      const name = basename(decodeURIComponent(req.headers.get("x-name") || "arquivo")).replace(/[^\w.\- ]+/g, "_").slice(-80) || "arquivo";
      const data = await req.arrayBuffer().catch(() => null);
      if (!data || !data.byteLength) return fail("arquivo vazio");
      if (data.byteLength > 25_000_000) return fail("anexo grande demais (máximo 25 MB)");
      const aid = crypto.randomUUID().slice(0, 8), path = join(ATTACH, `${aid}-${name}`);
      writeFileSync(path, new Uint8Array(data));
      const mime = req.headers.get("content-type") || "application/octet-stream";
      return json({ id: aid, name, path, mime, image: /^image\/(png|jpe?g|gif|webp)$/.test(mime) } satisfies Attachment);
    }

    if (resource === "history") {
      if (req.method === "POST" && id === "open") {
        try { return json({ id: convos.adopt(history.toConvo(String(body.file))).id }); } catch (e: any) { return fail(e.message); }
      }
      return json({ counts: history.counts(), items: history.list() });
    }

    if (resource === "convos") {
      const c = convos.get(id);
      if (!c) return fail("conversa não existe", 404);
      if (req.method === "DELETE" && action === "queue") { convos.unqueue(c.id, Number(extra)); return json({ ok: true }); }
      if (req.method === "DELETE") { convos.remove(c.id); return json({ ok: true }); }
      // conversa ao vivo (SSE): a página recebe cada mudança em vez de ficar perguntando
      if (req.method === "GET" && action === "stream") {
        srv.timeout(req, 0);
        const enc = new TextEncoder();
        let off: (() => void) | null = null, beat: any;
        const end = () => { off?.(); off = null; clearInterval(beat); };
        req.signal.addEventListener("abort", end);
        return new Response(new ReadableStream({
          start(ctrl) {
            const write = (text: string) => { try { ctrl.enqueue(enc.encode(text)); } catch { end(); } };
            off = convos.watch(c.id, (ev) => write(`data: ${JSON.stringify(ev)}\n\n`));
            beat = setInterval(() => write(": vivo\n\n"), 15_000);
          },
          cancel: end,
        }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
      }
      if (req.method === "POST" && action === "stop") { convos.stop(c.id); return json({ ok: true }); }
      if (req.method === "POST" && action === "review") {
        try { return json({ ok: true, reviewer: (await startReview(c, typeof body.target === "string" ? body.target : undefined, body.kind === "security" ? "security" : undefined)).id }); } catch (e: any) { return fail(e.message); }
      }
      if (req.method === "POST" && action === "decide") {
        try { convos.decide(c.id, String(body.req), body.decision === "always" ? "always" : body.decision === "allow" ? "allow" : "deny"); } catch (e: any) { return fail(e.message); }
        return json({ ok: true });
      }
      if (req.method === "POST" && action === "send") {
        const text = String(body.text || "").trim();
        if (!text && !asAttachments(body.attachments).length) return fail("escreva a mensagem");
        await Promise.all(accounts.filter((a) => !statusCache.has(a.id)).map(refreshStatus));
        try { return json({ ok: true, queued: convos.send(c, text, { target: typeof body.target === "string" ? body.target : undefined, mode: body.mode ? asMode(body.mode) : undefined, brain: typeof body.brain === "boolean" ? body.brain : undefined, attachments: asAttachments(body.attachments), model: asModel(body.model), effort: asEffort(body.effort) }) === "queued" }); }
        catch (e: any) { return fail(e.message); }
      }
      // a página pergunta com a revisão que já tem: sem mudança, resposta curta
      if (url.searchParams.get("rev") === String(c.rev)) return json({ rev: c.rev, same: true });
      return json(c);
    }

    if (resource === "brain") {
      try {
        if (req.method === "POST" && id === "semantic") { brain.enableSemantic(); return json(brain.info()); }
        if (req.method === "GET" && id === "search") return json(await brain.search(url.searchParams.get("q") || "", Number(url.searchParams.get("n")) || 8, url.searchParams.get("hint") || "", url.searchParams.has("ctx")));
        if (req.method === "GET" && id === "blocked") return json(brain.blockedNotes());
        if (req.method === "GET" && id === "tidy") return json(brain.tidy());
        if (req.method === "POST" && id === "tidy") return json({ moved: brain.autoTidy(), ...brain.tidy() });
        if (req.method === "POST" && id === "archive") return json({ to: brain.archive(String(body.note || "")), ...brain.tidy() });
        if (req.method === "POST" && id === "rules") { brain.setRules(body); return json(brain.info()); }
        if (req.method === "POST" && id === "sync") { brain.sync(); return json(brain.info()); }
        if (req.method === "POST" && id === "open") { openInObsidian(); return json({ ok: true }); }
        if (req.method === "POST" && id === "note") return json({ note: brain.addNote(String(body.title || ""), String(body.text || "")) });
      } catch (e: any) { return fail(e.message); }
      return json(brain.info());
    }

    if (resource === "vigil" && req.method === "POST") { vigil = body; return json({ ok: true }); }

    if (resource === "schedules") {
      try {
        if (req.method === "POST" && !id) {
          const prompt = String(body.prompt || "").trim(), cwd = validCwd(body.cwd);
          if (!prompt) return fail("escreva o pedido que vai ser agendado");
          if (!cwd) return fail("pasta não existe");
          if (!isTarget(body.target)) return fail("escolha uma conta para o agendamento");
          return json(schedules.add({ prompt, cwd, target: body.target, mode: asMode(body.mode), brain: body.brain !== false, isolate: !!body.isolate, kind: body.kind === "daily" ? "daily" : "once", at: Number(body.at) || undefined, time: typeof body.time === "string" ? body.time : undefined, days: Array.isArray(body.days) ? body.days.map(Number) : undefined }));
        }
        if (req.method === "POST" && action === "run") return json(await schedules.runNow(id));
        if (req.method === "POST" && (action === "on" || action === "off")) return json(schedules.toggle(id, action === "on"));
        if (req.method === "DELETE") { schedules.remove(id); return json({ ok: true }); }
      } catch (e: any) { return fail(e.message); }
      return json(schedules.list());
    }

    if (resource === "missions") {
      try {
        if (req.method === "POST" && !id) {
          const prompt = String(body.prompt || "").trim(), cwd = validCwd(body.cwd);
          const workers: string[] = (Array.isArray(body.targets) ? body.targets : []).filter(isTarget);
          if (!prompt) return fail("escreva o pedido que o supervisor vai dividir");
          if (!cwd || !(await repoInfo(cwd))) return fail("o supervisor trabalha com cópias isoladas: escolha uma pasta que seja um repositório git");
          if (!workers.length) return fail("escolha ao menos uma conta");
          await Promise.all(accounts.filter((a) => !statusCache.has(a.id)).map(refreshStatus));
          return json(missions.create({ prompt, cwd, planner: workers[0], workers }));
        }
        if (req.method === "POST" && action === "start") return json(await missions.start(id));
        if (req.method === "POST" && action === "merge") return json(await missions.merge(id));
        if (req.method === "DELETE") { missions.remove(id); return json({ ok: true }); }
        if (id) {
          const m = missions.get(id);
          if (!m) return fail("missão não existe", 404);
          // o estado de cada tarefa sai da conversa dela
          return json({ ...m, tasks: m.tasks.map((t) => { const c = t.convo ? convos.get(t.convo) : null, last = c?.messages.at(-1); return { ...t, working: !!c?.working, waiting: !!c?.waiting, state: t.error ? "erro" : !t.convo ? "pendente" : !c ? "apagada" : c.working ? (last?.review ? "em revisão" : "rodando") : last?.state === "error" ? "erro" : "pronta", who: c ? accName(account(c.accountId || "")) : "" }; }) });
        }
      } catch (e: any) { return fail(e.message); }
      return json(missions.list());
    }

    if (resource === "tools") {
      if (req.method === "POST") {
        let did = null;
        if (typeof body.on === "boolean") { settings.shareTools = body.on; did = shareTools(body.on); writeFileSync(SETTINGS_FILE, JSON.stringify(settings)); }
        else if (body.sync && settings.shareTools) did = shareTools(true);
        return json({ on: settings.shareTools, did, ...tools.summary(accounts) });
      }
      return json({ on: settings.shareTools, ...tools.summary(accounts) });
    }

    // o código de acesso só sai por aqui, pra página local montar o QR
    if (resource === "remote") {
      if (req.method === "POST") {
        try {
          if (typeof body.on === "boolean") { settings.remote = body.on; applyRemote(); }
          if (typeof body.send === "boolean") settings.remoteSend = body.send;
          if (body.rotate) remote.rotate();
        } catch (e: any) { return fail(e.message); }
        finally { writeFileSync(SETTINGS_FILE, JSON.stringify(settings)); }
      }
      return json({ ...remote.info(), send: settings.remoteSend });
    }

    if (resource === "rename" && req.method === "POST") {
      const title = String(body.title || "").trim().slice(0, 80);
      if (!title) return fail("o título não pode ficar vazio");
      if (body.type === "chat") convos.rename(String(body.id), title);
      else if (body.type === "session") { const s = sessions.get(String(body.id)); if (s) { s.title = title; if (!s.alive) archive(s); } }
      else return fail("este item não tem título editável");
      return json({ ok: true });
    }

    // o que mudou na pasta de trabalho: arquivos pendentes e o diff, pra revisar o que o agente fez
    if (resource === "diff") {
      const dir = validCwd(url.searchParams.get("cwd"));
      const d = dir ? await workDiff(dir, url.searchParams.get("main")) : null;
      if (!d) return json({ repo: false });
      return json({ repo: true, branch: d.branch, files: d.files, commits: d.commits, patch: d.patch.slice(0, 300_000), truncated: d.patch.length > 300_000 });
    }

    if (resource === "repo") {
      const dir = validCwd(url.searchParams.get("cwd"));
      const info = dir ? await repoInfo(dir) : null;
      // "ocupada": já tem agente trabalhando nesta pasta, então o próximo deveria ir numa cópia
      const busy = !!dir && (convos.inUse(dir) || [...sessions.values()].some((s) => s.alive && s.cwd === dir));
      return json({ repo: !!info, branch: info?.branch || "", busy });
    }

    if (resource === "clones") {
      if (req.method === "POST" && id === "remove") {
        try { return json(await clones.remove(String(body.path || ""))); } catch (e: any) { return fail(e.message); }
      }
      const items = await clones.scan(url.searchParams.has("scan"));
      return json({ ...clones.summary(), items });
    }

    if (resource === "settings" && req.method === "POST") {
      if (typeof body.rotate === "boolean") settings.rotate = body.rotate;
      if (typeof body.onboarded === "boolean") settings.onboarded = body.onboarded;
      if (typeof body.importChats === "boolean") settings.importChats = body.importChats;
      for (const k of ["keepAwake", "lidAwake", "lidFreeze", "autoReview", "autoRead", "suggest", "tidyBrain"] as const) if (typeof body[k] === "boolean") settings[k] = body[k];
      if (typeof body.autoClean === "boolean") { settings.autoClean = body.autoClean; if (body.autoClean) setTimeout(autoClean, 500); }
      if (typeof body.teach === "boolean") { settings.teach = body.teach; teachAll(body.teach); }
      writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
      return json(settings);
    }
    if (resource === "limits" && req.method === "DELETE") {
      delete limits[id];
      writeFileSync(LIMITS_FILE, JSON.stringify(limits, null, 2));
      return json({ ok: true });
    }

    if (resource === "accounts") {
      if (req.method === "POST" && !id) {
        if (!PROVIDERS[body.provider]) return fail("provedor inválido");
        const accId = `${body.provider}-${crypto.randomUUID().slice(0, 6)}`;
        const acc: Account = { id: accId, provider: body.provider, label: String(body.label || "nova conta").slice(0, 60), home: join(PROFILES, accId) };
        mkdirSync(acc.home!, { recursive: true });
        accounts.push(acc);
        saveAccounts();
        if (settings.teach) teach(acc, true);
        if (settings.shareTools) { try { tools.syncSkills(acc); } catch {} }
        return json({ id: accId });
      }
      const acc = account(id);
      if (!acc) return fail("conta não existe", 404);
      if (req.method === "PATCH") {
        if (typeof body.label === "string" && body.label.trim()) acc.label = body.label.trim().slice(0, 60);
        if (typeof body.env === "string") acc.env = parseEnv(body.env);
        saveAccounts();
        statusCache.delete(acc.id);
        return json({ ok: true });
      }
      if (req.method === "DELETE") {
        if (!acc.home) return fail("a conta padrão da máquina não sai daqui");
        if ([...sessions.values()].some((s) => s.accountId === acc.id && s.alive)) return fail("feche as sessões dessa conta antes");
        // o login não é apagado: o perfil vai pra lixeira e dá pra restaurar na mão
        const trash = join(ROOT, "trash");
        mkdirSync(trash, { recursive: true });
        if (existsSync(acc.home)) renameSync(acc.home, join(trash, `${acc.id}-${Date.now()}`));
        accounts = accounts.filter((a) => a.id !== acc.id);
        saveAccounts();
        return json({ ok: true });
      }
    }

    if (resource === "sessions") {
      if (req.method === "POST" && !id) {
        const acc = account(body.accountId);
        if (!acc) return fail("conta não existe", 404);
        const cwd = validCwd(body.cwd);
        if (!cwd) return fail("pasta não existe");
        try { return json({ id: startSession(acc, body.kind === "login" ? "login" : "chat", cwd, { cols: body.cols, rows: body.rows }).id }); }
        catch (e: any) { return fail(e.message); }
      }
      const s = sessions.get(id);
      if (!s) return fail("sessão não existe", 404);
      if (req.method === "DELETE") {
        const wasAlive = s.alive;
        if (wasAlive) s.proc.kill();
        for (const ws of s.clients) ws.close();
        // encerrar mantém a conversa no histórico; apagar de novo remove de vez
        if (!wasAlive || url.searchParams.has("purge")) {
          if (wasAlive) await s.proc.exited;
          sessions.delete(s.id);
          rmSync(join(HISTORY, `${s.id}.bin`), { force: true });
          writeFileSync(HISTORY_FILE, JSON.stringify([...sessions.values()].filter((x) => !x.alive).map(sessionMeta)));
        }
        return json({ ok: true });
      }
    }

    if (resource === "runs") {
      if (req.method === "GET" && !id) return json(runs.map(publicRun));
      const run = runs.find((r) => r.id === id);
      if (!run) return fail("disparo não existe", 404);
      if (req.method === "DELETE") {
        for (const j of run.jobs) if (j.state === "rodando") { j.state = "cancelado"; j.proc?.kill(); }
        runs.splice(runs.indexOf(run), 1);
        saveRuns();
        return json({ ok: true });
      }
      if (req.method === "POST" && action === "cancel") {
        for (const j of run.jobs) if (j.state === "rodando") { j.state = "cancelado"; j.proc?.kill(); }
        return json({ ok: true });
      }
      return json(publicRun(run));
    }
    return fail("rota não existe", 404);
  },
  websocket: {
    open(ws: any) {
      const s = sessions.get(ws.data.sid);
      if (!s) return ws.close();
      if (!s.alive && !s.buf.length) { try { ws.send(readFileSync(join(HISTORY, `${s.id}.bin`))); } catch {} }
      for (const chunk of s.buf) ws.send(chunk);
      s.clients.add(ws);
    },
    message(ws: any, raw) {
      const s = sessions.get(ws.data.sid);
      if (!s || !s.alive || typeof raw !== "string") return;
      const msg = JSON.parse(raw);
      if (msg.t === "i") s.proc.terminal.write(msg.d);
      else if (msg.t === "r" && msg.cols > 1 && msg.rows > 1) s.proc.terminal.resize(msg.cols, msg.rows);
    },
    close(ws: any) { sessions.get(ws.data.sid)?.clients.delete(ws); },
  },
});

function shutdown() {
  convos.flush();
  remote.stop();
  schedules.stop();
  missions.stop();
  for (const s of sessions.values()) if (s.alive) { s.alive = false; archive(s); s.proc.kill(); }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
clones.scan().catch(() => {});
try { brain.sync(); } catch (e) { console.error("cérebro: falha ao sincronizar", e); }
// mantém o bloco de instruções em dia (caminho do cofre, texto) nas contas já ensinadas
if (settings.teach) teachAll(true);
try { applyRemote(); } catch (e: any) { console.error(e.message); }
if (settings.shareTools) shareTools(true);
// arrumação do cérebro: de hora em hora, só o que dá pra fazer sem ler (nota vazia e cópia idêntica)
const tidyNow = () => { if (settings.tidyBrain) { try { brain.autoTidy(); } catch (e) { console.error("cérebro: arrumação", e); } } };
setInterval(tidyNow, 3_600_000);
tidyNow();
console.log(`revoada em http://127.0.0.1:${server.port}  (perfis em ${ROOT})`);
