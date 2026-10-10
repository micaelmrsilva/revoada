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
  writeFileSync(join(mem, "zebra-contato.md"), "---\nname: zebra-contato\ndescription: nota neutra\n---\nA zebra responde no endereço 203.0.113.7.\n");
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
  // chamadas avulsas de script (um pedido, sem tela): não são conversa e não devem aparecer
  writeFileSync(join(HOME, PROJECT, "avulsa.jsonl"), [
    { type: "user", cwd: GIT, entrypoint: "sdk-cli", timestamp: "2026-01-01T11:00:00Z", message: { role: "user", content: "Responda só: ok" } },
    { type: "assistant", cwd: GIT, entrypoint: "sdk-cli", timestamp: "2026-01-01T11:00:01Z", message: { id: "a9", content: [{ type: "text", text: "ok" }] } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n" + " ".repeat(200));
  writeFileSync(join(cx, "rollout-2026-01-01T11-00-00-avulsa1.jsonl"), [
    { timestamp: "2026-01-01T11:00:00Z", type: "session_meta", payload: { id: "avulsa1", cwd: GIT, originator: "codex_exec", source: "exec" } },
    { timestamp: "2026-01-01T11:00:01Z", type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Responda só: ok" }] } } },
    { timestamp: "2026-01-01T11:00:02Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  // os arquivos de histórico precisam parecer antigos o bastante pra não contarem como "abertos agora"
  const old = new Date(Date.now() - 3_600_000);
  for (const f of [join(HOME, PROJECT, "sessao-antiga.jsonl"), join(cx, "rollout-2026-01-01T10-00-00-abc123.jsonl"), join(HOME, PROJECT, "avulsa.jsonl"), join(cx, "rollout-2026-01-01T11-00-00-avulsa1.jsonl")]) require("fs").utimesSync(f, old, old);

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
    env: { ...process.env, HOME, REVOADA_HOME: join(HOME, ".revoada"), REVOADA_VAULT: VAULT, PORT: String(PORT), PATH: `${join(ROOT, "tests/stubs")}:${process.env.PATH}`, GEMINI_API_KEY: "", OLLAMA_HOST: "http://127.0.0.1:1", TZ: "UTC", REVOADA_ASSETS: "", REVOADA_PROJECTS: "", REVOADA_REMOTE_PORT: "" },
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
    expect(texts(c)).toContain(`retomei ${before}`);
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

  test("o que só lê roda sem perguntar; com a chave desligada volta a perguntar", async () => {
    const dir = join(HOME, "perm-leitura"); mkdirSync(dir);
    const c = await idle(await chat("claude-padrao", "SO-LEITURA", { mode: "ask", cwd: dir }));
    expect(c.messages.at(-1).items.some((i: any) => i.kind === "ask")).toBe(false);
    expect(texts(c)).toBe("permitido");
    await post("settings", { autoRead: false });
    const id = await chat("claude-padrao", "SO-LEITURA", { mode: "ask", cwd: dir });
    const waiting = await until(async () => { const x = await get(`convos/${id}`); return x.waiting && x; });
    expect(waiting.messages.at(-1).items.find((i: any) => i.kind === "ask").detail).toBe("ls -la | head -5");
    await post(`convos/${id}/stop`);
    await post("settings", { autoRead: true });
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
    expect(h.items.some((e: any) => e.title.startsWith("Responda só"))).toBe(false);
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

describe("revisão cruzada e tokens", () => {
  let id = "", reserva = "";

  test("outra conta, de outro provedor, revisa o diff sem tocar na sessão do autor", async () => {
    reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    id = await chat(reserva, "CRIA-ARQUIVO", { cwd: join(GIT, "app"), isolate: true });
    const before = await idle(id);
    expect((await post(`convos/${id}/review`)).reviewer).toBe("claude-padrao");
    const c = await idle(id);
    const rev = c.messages.at(-1);
    expect(rev.review).toBe(true);
    expect(rev.state).toBe("done");
    expect(rev.accountId).toBe("claude-padrao");
    // o revisor recebeu o arquivo novo (ainda fora do git) e rodou sem permissão de edição
    expect(texts(c)).toContain("revisor=true");
    expect(texts(c)).toContain("leitura=true");
    // o autor continua dono da conversa: mesma conta, mesma sessão nativa
    expect(c.accountId).toBe(reserva);
    expect(c.native).toEqual(before.native);
    await post(`convos/${id}/send`, { text: "corrija" });
    expect(texts(await idle(id))).toContain("retomei");
  }, SLOW);

  test("sem repositório ou sem mudança não há revisão", async () => {
    const solto = await chat(reserva, "oi");
    await idle(solto);
    const r = await api(`convos/${solto}/review`, "POST", {});
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("repositório git");
  }, SLOW);

  test("cada resposta guarda os tokens que o CLI informou", async () => {
    const c = await get(`convos/${id}`);
    expect(c.messages[1].tokens).toEqual({ in: 200, out: 30, cache: 1000 });
    expect(c.messages.find((m: any) => m.review).tokens).toEqual({ in: 120, out: 40, cache: 3000, usd: 0.05 });
  });

  test("revisão automática só dispara quando a resposta mexeu em arquivo", async () => {
    await post("settings", { autoReview: true });
    const quieto = await chat(reserva, "só conversa", { cwd: join(GIT, "app") });
    expect((await idle(quieto)).messages.length).toBe(2);
    const mexeu = await chat(reserva, "CRIA-ARQUIVO", { cwd: join(GIT, "app"), isolate: true });
    const c = await until(async () => { const x = await get(`convos/${mexeu}`); return x.messages.length === 3 && !x.working && x; });
    expect(c.messages[2].review).toBe(true);
    expect(c.messages[2].accountId).toBe("claude-padrao");
    await post("settings", { autoReview: false });
    await Bun.sleep(300);
    expect((await get(`convos/${quieto}`)).messages.length).toBe(2);
  }, SLOW);
});

describe("conversa ao vivo e fila", () => {
  test("aplicando os avisos em ordem chega-se ao mesmo estado da consulta, e eles vêm aos pedaços", async () => {
    await import("../public/sync.js");
    const apply = (globalThis as any).applyStream as (c: any, ev: any) => any;
    const id = await chat("claude-padrao", "DEMO-RICA ao vivo");
    const ctl = new AbortController();
    const res = await fetch(`${ORIGIN}/api/convos/${id}/stream`, { signal: ctl.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader(), dec = new TextDecoder();
    let buf = "", state: any = null, events = 0, small = 0, firsts = 0;
    while (!(state && !state.working && events > 1)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
        const line = buf.slice(0, i);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));
        events++; if (ev.first) firsts++;
        // aviso pequeno: só o item que mudou, não a conversa inteira
        if (!ev.first && ev.msgs.length === 1 && ev.msgs[0].at.length === 1) small++;
        state = apply(state, ev);
      }
    }
    ctl.abort();
    expect(firsts).toBe(1);
    expect(events).toBeGreaterThan(8);
    expect(small).toBeGreaterThan(5);
    expect(state.messages).toEqual((await get(`convos/${id}`)).messages);
    expect(state.messages.at(-1).items.at(-1).text).toContain("| Conta | Registrados (de 500) |");
  }, SLOW);

  test("mensagem mandada durante a resposta entra na fila, sai dela a pedido e a seguinte entra sozinha", async () => {
    const id = await chat("claude-padrao", "DEMO-RICA fila"); // responde devagar: dá tempo de enfileirar
    expect((await post(`convos/${id}/send`, { text: "primeira da fila" })).queued).toBe(true);
    expect((await post(`convos/${id}/send`, { text: "segunda da fila" })).queued).toBe(true);
    expect((await get(`convos/${id}`)).queue.map((q: any) => q.text)).toEqual(["primeira da fila", "segunda da fila"]);
    await api(`convos/${id}/queue/0`, "DELETE");
    const c = await until(async () => { const x = await get(`convos/${id}`); return x.messages.length === 4 && !x.working && x; });
    expect(c.messages.map((m: any) => m.text).filter(Boolean)).toEqual(["DEMO-RICA fila", "segunda da fila"]);
    expect(c.queue).toBeUndefined();
    expect(texts(c)).toContain("retomada=true"); // a da fila continuou a mesma sessão do agente
  }, SLOW);
});

describe("sugestão, auditoria de segurança e raio-x", () => {
  test("quando o agente termina, a conversa ganha a próxima mensagem provável; mandar outra apaga", async () => {
    const id = await chat("claude-padrao", "diga olá de novo");
    const c = await until(async () => { const x = await get(`convos/${id}`); return x.suggest && x; });
    expect(c.suggest).toBe("roda os testes agora");
    await post(`convos/${id}/send`, { text: "outra coisa" });
    expect((await get(`convos/${id}`)).suggest).toBeUndefined();
    await idle(id);
    // desligada nos ajustes, não gasta conta com isso
    await post("settings", { suggest: false });
    const quiet = await idle(await chat("claude-padrao", "sem sugestão"));
    await Bun.sleep(400);
    expect((await get(`convos/${quiet.id}`)).suggest).toBeUndefined();
    await post("settings", { suggest: true });
  }, SLOW);

  test("auditoria de segurança roda sem diff e sem git, só leitura, com o roteiro próprio", async () => {
    const reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    const id = await chat(reserva, "oi", { cwd: HOME });
    await idle(id);
    expect((await api(`convos/${id}/review`, "POST", {})).status).toBe(400); // a revisão comum precisa de mudança
    await post(`convos/${id}/review`, { kind: "security" });
    const c = await idle(id);
    expect([c.messages.at(-1).review, c.messages.at(-1).reviewKind]).toEqual([true, "security"]);
    expect(texts(c)).toContain("auditoria=true");
    expect(texts(c)).toContain("leitura=true");
  }, SLOW);

  test("cada resposta registra o que a Revoada pôs no pedido", async () => {
    const id = await chat("claude-padrao", "primeira");
    let c = await idle(id);
    expect(c.messages[1].sent).toEqual({ ask: 8, brain: 0, handoff: 0, resumed: false });
    await post(`convos/${id}/send`, { text: "segunda, na mesma sessão" });
    c = await idle(id);
    expect(c.messages[3].sent).toEqual({ ask: 24, brain: 0, handoff: 0, resumed: true });
    // trocar de conta leva o histórico, e ele aparece na conta
    const reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    await post(`convos/${id}/send`, { text: "terceira", target: reserva });
    c = await idle(id);
    expect(c.messages[5].sent.resumed).toBe(false);
    expect(c.messages[5].sent.handoff).toBeGreaterThan(200);
  }, SLOW);
});

describe("pedidos agendados", () => {
  test("agenda, roda na hora pedida a mão e recusa hora que já passou", async () => {
    expect((await api("schedules", "POST", { prompt: "relatório", target: "claude-padrao", cwd: HOME, kind: "once", at: Date.now() - 60_000 })).body.error).toContain("já passou");
    expect((await api("schedules", "POST", { prompt: "relatório", target: "conta-que-nao-existe", cwd: HOME, kind: "daily", time: "03:00" })).status).toBe(400);
    const s = await post("schedules", { prompt: "relatório da madrugada", target: "claude-padrao", cwd: HOME, kind: "daily", time: "03:00", days: [1, 3] });
    expect(s.enabled).toBe(true);
    expect([1, 3]).toContain(new Date(s.next).getDay());
    expect(new Date(s.next).getHours()).toBe(3);
    const ran = await post(`schedules/${s.id}/run`);
    const c = await idle(ran.last.convo);
    expect(c.messages[0].text).toBe("relatório da madrugada");
    expect((await post(`schedules/${s.id}/off`)).next).toBeNull();
    expect((await post(`schedules/${s.id}/on`)).next).toBe(s.next);
    await api(`schedules/${s.id}`, "DELETE");
    expect(await get("schedules")).toEqual([]);
  }, SLOW);
});

describe("skills e MCP em todas as contas", () => {
  test("skill da conta padrão vira atalho nas outras; pasta própria da conta não é tocada", async () => {
    const reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    const src = join(HOME, ".codex/skills"), dest = join(HOME, ".revoada/profiles", reserva, "skills");
    for (const n of ["resumir", "auditar"]) { mkdirSync(join(src, n), { recursive: true }); writeFileSync(join(src, n, "SKILL.md"), `# ${n}\n`); }
    mkdirSync(join(src, "sem-skill")); // pasta sem SKILL.md não é skill
    mkdirSync(join(dest, "propria"), { recursive: true }); writeFileSync(join(dest, "propria", "SKILL.md"), "minha\n");
    const codex = (await get("state")).accounts.filter((a: any) => a.provider === "codex" && a.isolated).length; // toda conta isolada do Codex recebe
    const on = await post("tools", { on: true });
    expect(on.did.linked).toBe(2 * codex);
    expect(readFileSync(join(dest, "resumir", "SKILL.md"), "utf8")).toBe("# resumir\n");
    expect(require("fs").lstatSync(join(dest, "resumir")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dest, "sem-skill"))).toBe(false);
    expect(on.accounts.find((a: any) => a.id === reserva)).toEqual({ id: reserva, linked: 2, own: 1 });
    // saiu da fonte: o atalho some na próxima sincronização; a pasta própria fica
    rmSync(join(src, "auditar"), { recursive: true });
    expect((await post("tools", { sync: true })).did.removed).toBe(codex);
    expect(existsSync(join(dest, "auditar"))).toBe(false);
    expect(readFileSync(join(dest, "propria", "SKILL.md"), "utf8")).toBe("minha\n");
  });

  test("servidores MCP da conta padrão vão como argumento nas outras contas, e só nelas", async () => {
    writeFileSync(join(HOME, ".claude.json"), JSON.stringify({ mcpServers: { demo: { command: "demo-mcp", args: ["--porta", "1"], env: { CHAVE: "segredo" } } } }));
    writeFileSync(join(HOME, ".codex/config.toml"), 'model = "x"\n\n[mcp_servers.demo]\ncommand = "demo-mcp"\nargs = ["--porta", "1"]\n\n[mcp_servers.demo.env]\nCHAVE = "segredo"\n');
    const s = await get("state");
    const reserva = s.accounts.find((a: any) => a.label === "reserva").id;
    const extra = (await post("accounts", { provider: "claude", label: "segunda" })).id;
    await get("state?refresh=1");
    expect(texts(await idle(await chat(reserva, "com mcp")))).toContain('mcp=mcp_servers.demo={ command = "demo-mcp", args = ["--porta", "1"], env = { CHAVE = "segredo" } }');
    const file = texts(await idle(await chat(extra, "com mcp"))).match(/mcp=(\S+)/)![1];
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ mcpServers: { demo: { command: "demo-mcp", args: ["--porta", "1"], env: { CHAVE: "segredo" } } } });
    expect(require("fs").statSync(file).mode & 0o077).toBe(0); // tem chave dentro: só o dono lê
    expect(texts(await idle(await chat("claude-padrao", "sem mcp")))).toContain("mcp=nao"); // a padrão já tem os dela
    // desligar tira os atalhos e os argumentos
    const off = await post("tools", { on: false });
    expect(off.did.removed).toBe(s.accounts.filter((a: any) => a.provider === "codex" && a.isolated).length);
    expect(texts(await idle(await chat(reserva, "sem mcp")))).toContain("mcp=nao");
    expect(existsSync(join(HOME, ".revoada/profiles", reserva, "skills", "propria", "SKILL.md"))).toBe(true);
  }, SLOW);
});

describe("arrumação do cérebro", () => {
  test("acha nota vazia, cópia idêntica e parecida; arquivar tira da busca sem apagar", async () => {
    const body = "A zebra de teste usa listras verticais no painel de relatórios e exporta em CSV toda sexta de manhã para a equipe.";
    await post("brain/note", { title: "relatorio zebra", text: body });
    await post("brain/note", { title: "relatorio zebra copia", text: body });
    await post("brain/note", { title: "relatorio zebra parecido", text: body + " O time comercial também recebe." });
    await post("brain/note", { title: "vazia", text: "ok" });
    const t = await get("brain/tidy");
    expect(t.empty).toEqual(["Revoada/vazia.md"]);
    expect(t.copies.length).toBe(1);
    expect(t.copies[0].drop.length).toBe(1);
    expect(t.similar.some((p: any) => [p.a, p.b].includes("Revoada/relatorio zebra parecido.md") && p.score >= 0.6)).toBe(true);
    // automático: só o que não exige ler
    const auto = await post("brain/tidy");
    expect(auto.moved.sort()).toEqual([t.copies[0].drop[0], "Revoada/vazia.md"].sort());
    expect(existsSync(join(VAULT, "Revoada/Arquivo/vazia.md"))).toBe(true);
    expect([auto.empty, auto.copies]).toEqual([[], []]);
    // a parecida continua lá, esperando alguém decidir; arquivar à mão tira da busca
    const hits = async () => (await get("brain/search?q=zebra+listras+verticais+painel+relatorios&n=10")).map((h: any) => h.note);
    expect(await hits()).toContain("Revoada/relatorio zebra parecido.md");
    await post("brain/archive", { note: "Revoada/relatorio zebra parecido.md" });
    expect(await hits()).not.toContain("Revoada/relatorio zebra parecido.md");
    expect((await api("brain/archive", "POST", { note: "Agentes/Claude/git/zebra-produto.md" })).status).toBe(400);
  });
});

describe("supervisor", () => {
  test("planeja, espera aprovação, roda cada tarefa em cópia própria com revisão e junta os branches", async () => {
    const reserva = (await get("state")).accounts.find((a: any) => a.label === "reserva").id;
    expect((await api("missions", "POST", { prompt: "x", cwd: HOME, targets: ["claude-padrao"] })).body.error).toContain("repositório git");
    const main = join(GIT, "app");
    const m = await post("missions", { prompt: "Exportação e importação da loja", cwd: main, targets: ["claude-padrao", reserva] });
    const plan = await until(async () => { const x = await get(`missions/${m.id}`); return x.state === "plano" && x; });
    expect(plan.tasks.map((t: any) => [t.title, t.state])).toEqual([["Exportação de pedidos", "pendente"], ["Importação de clientes", "pendente"]]);
    expect(plan.note).toContain("duas frentes");
    expect((await get("state")).convos.filter((c: any) => c.cwd.includes("worktrees") && c.title.includes("Exportação")).length).toBe(0); // nada roda antes de aprovar
    await post(`missions/${m.id}/start`);
    const done = await until(async () => { const x = await get(`missions/${m.id}`); return x.state === "pronta" && x; }, 25_000);
    expect(done.tasks.every((t: any) => t.state === "pronta" && t.branch.startsWith("revoada/"))).toBe(true);
    expect(new Set(done.tasks.map((t: any) => t.branch)).size).toBe(2);
    // a tarefa que foi para o Codex criou arquivo na cópia dela, fora da pasta principal, e foi revisada
    const codexTask = await get(`convos/${done.tasks[1].convo}`);
    expect(codexTask.accountId).toBe(reserva);
    expect(existsSync(join(codexTask.cwd, "novo.txt"))).toBe(true);
    expect(existsSync(join(main, "novo.txt"))).toBe(false);
    expect(codexTask.messages.filter((x: any) => x.review).length).toBe(1);
    expect(codexTask.messages[0].text).toContain("faça commit");
    const merged = await post(`missions/${m.id}/merge`);
    const mc = await idle(merged.merge);
    for (const t of done.tasks) expect(mc.messages[0].text).toContain(t.branch);
    expect(mc.worktree.branch.startsWith("revoada/juntar")).toBe(true);
    await api(`missions/${m.id}`, "DELETE");
    expect((await get("missions")).length).toBe(0);
  }, 60_000);
});

describe("acompanhar pelo celular", () => {
  const REMOTE = `http://127.0.0.1:${PORT + 1}`;
  const token = () => JSON.parse(readFileSync(join(HOME, ".revoada/remote.json"), "utf8")).token as string;
  const r = async (path: string, method = "GET", body?: unknown, tok = token()) => {
    const res = await fetch(`${REMOTE}/r/${path}`, { method, headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  };

  test("nasce desligado: nada escuta fora do painel", async () => {
    expect((await get("state")).remote.on).toBe(false);
    expect(await fetch(`${REMOTE}/`).then(() => "aberto").catch(() => "fechado")).toBe("fechado");
  });

  test("ligado, só entra com o código e só enxerga a API pequena", async () => {
    expect((await post("remote", { on: true })).on).toBe(true);
    expect((await fetch(`${REMOTE}/`)).status).toBe(200);
    expect((await r("state", "GET", undefined, "errado")).status).toBe(401);
    expect((await fetch(`${REMOTE}/r/state`)).status).toBe(401);
    const s = await r("state");
    expect(s.status).toBe(200);
    expect(s.body.convos.length).toBeGreaterThan(0);
    expect(JSON.stringify(s.body)).not.toContain(HOME); // caminho da máquina não sai
    // o que o painel faz não existe nesta porta
    for (const path of ["/api/state", "/api/accounts", "/api/settings", "/ws", "/r/accounts", "/r/settings"]) {
      expect((await fetch(`${REMOTE}${path}`, { method: "POST", headers: { authorization: `Bearer ${token()}` }, body: "{}" })).status).toBe(404);
    }
  }, SLOW);

  test("permite pelo celular; mandar mensagem só com a chave ligada", async () => {
    const dir = join(HOME, "perm-celular"); mkdirSync(dir);
    const id = await chat("claude-padrao", "crie o arquivo", { mode: "ask", cwd: dir });
    const waiting = await until(async () => { const c = (await r(`convos/${id}`)).body; return c.waiting && c; });
    const ask = waiting.messages.at(-1).items.find((i: any) => i.kind === "ask");
    expect((await r(`convos/${id}/decide`, "POST", { req: ask.req, decision: "allow" })).status).toBe(200);
    await idle(id);
    expect(existsSync(join(dir, "feito.txt"))).toBe(true);
    expect((await r(`convos/${id}/send`, "POST", { text: "mais uma" })).status).toBe(403);
    expect((await post("remote", { send: true })).send).toBe(true);
    expect((await r(`convos/${id}/send`, "POST", { text: "mais uma" })).status).toBe(200);
    // o pedido novo também para esperando: parar pelo celular encerra
    await until(async () => (await r(`convos/${id}`)).body.waiting);
    expect((await r(`convos/${id}/stop`, "POST", {})).status).toBe(200);
    expect((await idle(id)).messages.at(-1).state).toBe("stopped");
  }, SLOW);

  test("trocar o código derruba quem tinha o antigo; errar demais bloqueia; desligar fecha a porta", async () => {
    const old = token();
    await post("remote", { rotate: true });
    expect(token()).not.toBe(old);
    expect((await r("state", "GET", undefined, old)).status).toBe(401);
    expect((await r("state")).status).toBe(200);
    for (let i = 0; i < 8; i++) await r("state", "GET", undefined, "chute");
    expect((await r("state")).status).toBe(429);
    expect((await post("remote", { on: false })).on).toBe(false);
    expect(await fetch(`${REMOTE}/`).then(() => "aberto").catch(() => "fechado")).toBe("fechado");
  }, SLOW);
});
