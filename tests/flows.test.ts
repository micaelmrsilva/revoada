// Fluxos principais, de ponta a ponta: sobe o servidor de verdade numa pasta de usuário
// descartável, com CLIs de mentira no PATH (tests/stubs), e conversa com ele pela API.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

const ROOT = join(import.meta.dir, "..");
const PORT = 4900 + Math.floor(Math.random() * 90);
const ORIGIN = `http://127.0.0.1:${PORT}`;
// fora de /tmp: o app esconde de propósito o histórico de conversas que rodaram lá (no macOS a
// pasta temporária já é outra; no GitHub usa-se a do runner)
const HOME = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "revoada-teste-"));
const VAULT = join(HOME, "cofre");
const GIT = join(HOME, "git");
// o Claude Code nomeia a pasta de cada projeto pelo caminho, com traços no lugar das barras
const PROJECT = `.claude/projects/-Users-${basename(HOME)}-git`;
const SLOW = 30_000;
let server: any;

const sh = (cwd: string, ...cmd: string[]) => { const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" }); if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr}`); return r.stdout.toString().trim(); };
const git = (cwd: string, ...args: string[]) => sh(cwd, "git", "-c", "user.name=teste", "-c", "user.email=teste@exemplo.dev", ...args);

async function api(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${ORIGIN}/api/${path}`, { method, headers: { origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
const get = async (path: string) => (await api(path)).body;
const post = async (path: string, body: unknown = {}) => { const r = await api(path, "POST", body); if (r.status !== 200) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
async function until<T>(fn: () => Promise<T | false | null | undefined>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await Bun.sleep(120); }
  throw new Error("esperei demais");
}
const idle = (id: string) => until(async () => { const c = await get(`convos/${id}`); return !c.working && c; });
const texts = (c: any, i = -1) => c.messages.at(i).items.filter((x: any) => x.kind === "text").map((x: any) => x.text).join(" ");
const chat = async (target: string, prompt: string, extra: Record<string, unknown> = {}) => (await post("chat", { prompt, targets: [target], cwd: HOME, brain: false, mode: "edit", ...extra })).id as string;

beforeAll(async () => {
  // memória de agente: uma nota comum, uma de finanças e uma de infra
  const mem = join(HOME, PROJECT, "memory");
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, "zebra-produto.md"), "---\nname: zebra-produto\ndescription: o que é o produto zebra\n---\nZebra é um app de listras para pequenas empresas.\n");
  writeFileSync(join(mem, "zebra-finance-visor.md"), "---\nname: zebra-finance-visor\ndescription: renda e orçamento\n---\nRenda mensal da zebra e saldo.\n");
  writeFileSync(join(mem, "zebra-contato.md"), "---\nname: zebra-contato\ndescription: nota neutra\n---\nA zebra responde no endereço 16.59.23.249.\n");
  writeFileSync(join(HOME, ".claude/CLAUDE.md"), "# Regras\n\nSempre em pt-BR.\n");
  // histórico de outro programa: uma sessão do Claude Code e uma do Codex
  writeFileSync(join(HOME, PROJECT, "sessao-antiga.jsonl"), [
    { type: "user", cwd: GIT, timestamp: "2026-01-01T10:00:00Z", message: { role: "user", content: "como anda a zebra?" } },
    { type: "assistant", cwd: GIT, timestamp: "2026-01-01T10:00:05Z", message: { id: "a1", content: [{ type: "text", text: "A zebra anda bem." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", cwd: GIT, timestamp: "2026-01-01T10:00:06Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt" }] } },
    { type: "custom-title", customTitle: "Estado da zebra", sessionId: "sessao-antiga" },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  const cx = join(HOME, ".codex/sessions/2026/01/01");
  mkdirSync(cx, { recursive: true });
  writeFileSync(join(cx, "rollout-2026-01-01T10-00-00-abc123.jsonl"), [
    { timestamp: "2026-01-01T10:00:00Z", type: "session_meta", payload: { id: "abc123", cwd: GIT } },
    { timestamp: "2026-01-01T10:00:01Z", type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "liste os arquivos" }] } } },
    { timestamp: "2026-01-01T10:00:02Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Só a.txt." }] } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  // os arquivos de histórico precisam parecer antigos o bastante pra não contarem como "abertos agora"
  const old = new Date(Date.now() - 3_600_000);
  for (const f of [join(HOME, PROJECT, "sessao-antiga.jsonl"), join(cx, "rollout-2026-01-01T10-00-00-abc123.jsonl")]) require("fs").utimesSync(f, old, old);

  // repositório principal com origem, mais duas cópias: uma limpa e uma com trabalho local
  mkdirSync(GIT, { recursive: true });
  const origin = join(HOME, "origem.git");
  // branch padrão explícito: em máquina nova o git ainda cria "master"
  sh(HOME, "git", "init", "-q", "--bare", "-b", "main", origin);
  const main = join(GIT, "app");
  sh(GIT, "git", "init", "-q", "-b", "main", main);
  writeFileSync(join(main, "README.md"), "# app\n");
  git(main, "add", "."); git(main, "commit", "-qm", "inicial"); git(main, "branch", "-M", "main");
  git(main, "remote", "add", "origin", origin); git(main, "push", "-q", "-u", "origin", "main");
  for (const name of ["app-copia-limpa", "app-copia-suja"]) { sh(GIT, "git", "clone", "-q", origin, name); }
  writeFileSync(join(GIT, "app-copia-suja", "rascunho.txt"), "só existe aqui");

  server = Bun.spawn(["bun", "server.ts"], {
    cwd: ROOT, stdout: "ignore", stderr: "inherit",
    env: { ...process.env, HOME, REVOADA_HOME: join(HOME, ".revoada"), REVOADA_VAULT: VAULT, PORT: String(PORT), PATH: `${join(ROOT, "tests/stubs")}:${process.env.PATH}`, GEMINI_API_KEY: "", OLLAMA_HOST: "http://127.0.0.1:1" },
  });
  await until(async () => (await fetch(`${ORIGIN}/api/dirs`).then((r) => r.ok).catch(() => false)));
  await get("state?refresh=1");
}, SLOW);

afterAll(async () => {
  server?.kill();
  await server?.exited;
  rmSync(HOME, { recursive: true, force: true });
});

describe("servidor", () => {
  test("só aceita chamada da própria página", async () => {
    expect((await fetch(`${ORIGIN}/api/settings`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await fetch(`${ORIGIN}/api/state`, { headers: { origin: "http://outro.site" } })).status).toBe(403);
    expect((await api("state")).status).toBe(200);
  });

  test("enxerga as contas já logadas na máquina", async () => {
    const s = await get("state");
    const ok = Object.fromEntries(s.accounts.map((a: any) => [a.id, a.status.ok]));
    expect(ok["claude-padrao"]).toBe(true);
    expect(ok["codex-padrao"]).toBe(true);
    expect(s.accounts.find((a: any) => a.id === "claude-padrao").status.detail).toContain("Max");
  });
});

describe("conversa e rodízio", () => {
  let reserva = "", terceira = "", id = "";

  test("conta nova nasce isolada e sem herdar o limite da outra", async () => {
    reserva = (await post("accounts", { provider: "codex", label: "reserva" })).id;
    terceira = (await post("accounts", { provider: "codex", label: "terceira" })).id;
    const s = await get("state?refresh=1");
    expect(s.accounts.find((a: any) => a.id === reserva).isolated).toBe(true);
    expect(s.accounts.find((a: any) => a.id === reserva).status.ok).toBe(true);
  }, SLOW);

  test("limite no meio da resposta troca de conta e leva o que já foi feito", async () => {
    id = await chat("pool:codex", "primeiro pedido");
    const c = await idle(id);
    const last = c.messages.at(-1);
    expect(last.state).toBe("done");
    expect(last.items.some((i: any) => i.kind === "note" && i.text.includes("bateu no limite"))).toBe(true);
    expect(texts(c)).toContain("historico=true");
    expect(texts(c)).toContain("viu-comando=true");
    expect(c.accountId).not.toBe("codex-padrao");
    const s = await get("state");
    expect(s.accounts.find((a: any) => a.id === "codex-padrao").limit).toBeTruthy();
  }, SLOW);

  test("mesma conta retoma a sessão nativa", async () => {
    const before = (await get(`convos/${id}`)).native.sessionId;
    await post(`convos/${id}/send`, { text: "segundo pedido" });
    const c = await idle(id);
    expect(texts(c)).toBe(`retomei ${before}`);
  }, SLOW);

  test("trocar de conta à mão leva o histórico da conversa", async () => {
    const cur = (await get(`convos/${id}`)).accountId;
    await post(`convos/${id}/send`, { text: "terceiro pedido", target: cur === reserva ? terceira : reserva });
    const c = await idle(id);
    expect(c.accountId).not.toBe(cur);
    expect(texts(c)).toContain("historico=true");
    expect(texts(c)).toContain("viu-retomada=true");
  }, SLOW);

  test("conta marcada no limite é pulada no próximo pedido", async () => {
    const c = await idle(await chat("pool:codex", "outro pedido"));
    expect(c.messages.at(-1).items.some((i: any) => i.kind === "note")).toBe(false);
    expect(texts(c)).toContain("historico=false");
  }, SLOW);

  test("renomear e apagar", async () => {
    await post("rename", { type: "chat", id, title: "Nome novo" });
    expect((await get(`convos/${id}`)).title).toBe("Nome novo");
    expect((await api(`convos/${id}`, "DELETE")).status).toBe(200);
    expect((await api(`convos/${id}`)).status).toBe(404);
  });
});

describe("claude: texto ao vivo, consumo, título e permissão", () => {
  test("texto aos pedaços vira uma resposta só, e o consumo fica registrado", async () => {
    const c = await idle(await chat("claude-padrao", "diga olá"));
    const items = c.messages.at(-1).items.filter((i: any) => i.kind === "text");
    expect(items.length).toBe(1);
    expect(items[0].text).toContain("olá mundo");
    const acc = (await get("state")).accounts.find((a: any) => a.id === "claude-padrao");
    expect(acc.usage.find((u: any) => u.key === "five_hour").pct).toBe(42);
    const titled = await until(async () => { const x = await get(`convos/${c.id}`); return x.title === "Título de teste" && x; });
    expect(titled.titled).toBe(true);
  }, SLOW);

  test("no modo perguntar nada roda antes de permitir", async () => {
    const dir = join(HOME, "perm-sim"); mkdirSync(dir);
    const id = await chat("claude-padrao", "crie o arquivo", { mode: "ask", cwd: dir });
    const waiting = await until(async () => { const c = await get(`convos/${id}`); return c.waiting && c; });
    const ask = waiting.messages.at(-1).items.find((i: any) => i.kind === "ask");
    expect(ask.state).toBe("pending");
    expect(ask.detail).toBe("touch feito.txt");
    expect(existsSync(join(dir, "feito.txt"))).toBe(false);
    expect((await get("state")).convos.find((c: any) => c.id === id).waiting).toBe(true);
    await post(`convos/${id}/decide`, { req: ask.req, decision: "allow" });
    const c = await idle(id);
    expect(existsSync(join(dir, "feito.txt"))).toBe(true);
    expect(texts(c)).toBe("permitido");
    expect(c.messages.at(-1).items.find((i: any) => i.kind === "ask").state).toBe("allowed");
  }, SLOW);

  test("negar impede a ação", async () => {
    const dir = join(HOME, "perm-nao"); mkdirSync(dir);
    const id = await chat("claude-padrao", "crie o arquivo", { mode: "ask", cwd: dir });
    const waiting = await until(async () => { const c = await get(`convos/${id}`); return c.waiting && c; });
    await post(`convos/${id}/decide`, { req: waiting.messages.at(-1).items.find((i: any) => i.kind === "ask").req, decision: "deny" });
    const c = await idle(id);
    expect(existsSync(join(dir, "feito.txt"))).toBe(false);
    expect(texts(c)).toBe("negado");
  }, SLOW);

  test("imagem anexada chega ao agente; anexo de fora é recusado", async () => {
    const up = await fetch(`${ORIGIN}/api/attach`, { method: "POST", headers: { origin: ORIGIN, "content-type": "image/png", "x-name": "print.png" }, body: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) });
    const att = await up.json() as any;
    expect(att.image).toBe(true);
    expect(texts(await idle(await chat("claude-padrao", "veja", { attachments: [att] })))).toContain("imagens=1");
    expect(texts(await idle(await chat("claude-padrao", "veja", { attachments: [{ ...att, path: "/etc/passwd" }] })))).toContain("imagens=0");
  }, SLOW);
});

describe("cérebro", () => {
  test("nota de finanças e de infra não entram no cofre nem no contexto", async () => {
    expect(existsSync(join(VAULT, "Agentes/Claude/git/zebra-produto.md"))).toBe(true);
    expect(existsSync(join(VAULT, "Agentes/Claude/git/zebra-finance-visor.md"))).toBe(false);
    expect(existsSync(join(VAULT, "Agentes/Claude/git/zebra-contato.md"))).toBe(false);
    const hits = await get("brain/search?ctx=1&q=zebra");
    expect(hits.map((h: any) => h.title)).toEqual(["zebra-produto"]);
    expect((await get("brain")).blocked).toEqual({ "finanças": 1, infra: 1 });
  });

  test("pedido genérico não puxa memória; liberar uma nota a traz de volta", async () => {
    expect(await get("brain/search?ctx=1&q=" + encodeURIComponent("arruma o bug do botão no cabeçalho"))).toEqual([]);
    await post("brain/rules", { allow: "Agentes/Claude/git/zebra-finance-visor.md" });
    expect(existsSync(join(VAULT, "Agentes/Claude/git/zebra-finance-visor.md"))).toBe(true);
    await post("brain/rules", { block: "Agentes/Claude/git/zebra-finance-visor.md" });
    expect(existsSync(join(VAULT, "Agentes/Claude/git/zebra-finance-visor.md"))).toBe(false);
  });

  test("o contexto do cérebro vai junto do pedido", async () => {
    const reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    const c = await idle(await chat(reserva, "o que é o produto zebra", { brain: true }));
    expect(texts(c)).toContain("cerebro=true");
    expect(c.messages.at(-1).brain).toEqual(["zebra-produto"]);
  }, SLOW);

  test("ensinar os agentes escreve só o bloco e desfaz sem deixar rastro", async () => {
    const file = join(HOME, ".claude/CLAUDE.md"), original = readFileSync(file, "utf8");
    await post("settings", { teach: true });
    const taught = readFileSync(file, "utf8");
    expect(taught.startsWith(original.trim())).toBe(true);
    expect(taught).toContain("revoada:cerebro:inicio");
    await post("settings", { teach: true });
    expect(readFileSync(file, "utf8")).toBe(taught);
    await post("settings", { teach: false });
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});

describe("cópias de repositório", () => {
  test("classifica as cópias e nunca aceita remover a principal", async () => {
    const r = await get("clones?scan=1");
    const by = Object.fromEntries(r.items.map((c: any) => [c.name, c]));
    expect(Object.keys(by).sort()).toEqual(["app-copia-limpa", "app-copia-suja"]);
    expect(by["app-copia-limpa"].safe).toBe(true);
    expect(by["app-copia-suja"].safe).toBe(false);
    expect(by["app-copia-limpa"].main).toBe(join(GIT, "app"));
    expect(by["app-copia-limpa"].auto).toBe(false); // limpa, mas sem PR: não sai sozinha
    expect((await api("clones/remove", "POST", { path: join(GIT, "app") })).status).toBe(400);
    expect((await api("clones/remove", "POST", { path: HOME })).status).toBe(400);
  }, SLOW);

  test("cópia isolada: o agente trabalha fora da principal, e ela sai quando não sobra nada só nela", async () => {
    const main = join(GIT, "app");
    const reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    const id = await chat(reserva, "CRIA-ARQUIVO", { cwd: main, isolate: true });
    const c = await idle(id);
    expect(c.worktree.branch.startsWith("revoada/")).toBe(true);
    expect(existsSync(join(c.cwd, "novo.txt"))).toBe(true);
    expect(existsSync(join(main, "novo.txt"))).toBe(false);
    // com trabalho pendente ela é "trabalho local" e fica
    let copy = (await get("clones?scan=1")).items.find((x: any) => x.path === c.worktree.path);
    expect(copy.managed).toBe(true);
    expect(copy.safe).toBe(false);
    // trabalho no remoto e conversa encerrada: pode sair
    git(c.cwd, "add", "."); git(c.cwd, "commit", "-qm", "novo"); git(c.cwd, "push", "-q", "-u", "origin", c.worktree.branch);
    await api(`convos/${id}`, "DELETE");
    copy = (await get("clones?scan=1")).items.find((x: any) => x.path === c.worktree.path);
    expect(copy.safe).toBe(true);
    await post("clones/remove", { path: c.worktree.path });
    expect(existsSync(c.worktree.path)).toBe(false);
    expect(git(main, "branch", "--list", c.worktree.branch)).toBe("");
    expect(git(main, "branch", "-r", "--list", `origin/${c.worktree.branch}`)).not.toBe("");
  }, SLOW);
});

describe("conversas dos outros programas", () => {
  test("lista o que o Claude Code e o Codex guardaram e abre ligado à sessão original", async () => {
    const h = await get("history");
    const claude = h.items.find((e: any) => e.src === "claude"), codex = h.items.find((e: any) => e.src === "codex");
    expect(claude.title).toBe("Estado da zebra");
    expect(codex.title).toBe("liste os arquivos");
    const c = await get(`convos/${(await post("history/open", { file: claude.file })).id}`);
    expect(c.native).toEqual({ accountId: "claude-padrao", sessionId: "sessao-antiga" });
    expect(c.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(c.messages[1].items.map((i: any) => [i.kind, i.output || i.text])).toEqual([["text", "A zebra anda bem."], ["cmd", "a.txt"]]);
    const x = await get(`convos/${(await post("history/open", { file: codex.file })).id}`);
    expect(x.native.sessionId).toBe("abc123");
    expect(texts(x)).toBe("Só a.txt.");
    // continuar uma importada retoma a sessão original em vez de começar outra
    await post(`convos/${c.id}/send`, { text: "e agora?", mode: "edit" });
    expect(texts(await idle(c.id))).toContain("retomada=true");
  }, SLOW);
});
