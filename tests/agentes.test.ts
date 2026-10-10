// A Revoada usada por agentes: a ponte MCP que cada CLI recebe, o que ela deixa fazer, as travas
// (limite por conversa, sem delegar em cadeia, só leitura, alcance) e a linha de comando.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { mkdirSync, readFileSync, realpathSync, statSync } from "fs";
import { join } from "path";
import { sobe } from "./ambiente";

let env: Awaited<ReturnType<typeof sobe>>;
const SLOW = 40_000, ROOT = join(import.meta.dir, "..");
const texts = (c: any, i = -1) => c.messages.at(i).items.filter((x: any) => x.kind === "text").map((x: any) => x.text).join(" ");
// a credencial de uma conversa, feita do mesmo jeito que o servidor faz
const token = (id: string) => `${id}.${createHmac("sha256", readFileSync(join(env.home, ".revoada/agent-secret"), "utf8").trim()).update(id).digest("hex")}`;
const agent = async (convo: string, tool: string, body: unknown = {}, tok = token(convo)) => {
  const r = await fetch(`${env.origin}/agent/${tool}`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json().catch(() => ({})) as any) };
};
const cli = (...args: string[]) => { const p = Bun.spawnSync(["bun", join(ROOT, "cli.ts"), ...args], { cwd: env.repo, env: { ...process.env, REVOADA_PORT: new URL(env.origin).port }, stdout: "pipe", stderr: "pipe" }); return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() }; };
let reserva = "";

beforeAll(async () => {
  process.env.REVOADA_AGENT_BUDGET = "3"; // limite pequeno pra dar pra bater nele
  env = await sobe();
  delete process.env.REVOADA_AGENT_BUDGET;
  reserva = (await env.api("accounts", "POST", { provider: "codex", label: "reserva" })).id;
  await env.api("state?refresh=1");
}, SLOW);
afterAll(async () => { await env?.stop(); });

describe("a ponte que cada agente recebe", () => {
  test("Claude e Codex sobem a ponte da Revoada em toda conversa; desligado em Ajustes, não", async () => {
    const a = await env.idle(await env.chat("claude-padrao", "oi"));
    expect(texts(a)).toContain("revoada=sim; liberadas=mcp__revoada"); // ferramenta já conferida no servidor não pede permissão a cada uso
    const file = join(env.home, ".revoada/agentes", `${a.id}.json`);
    expect(statSync(file).mode & 0o077).toBe(0); // tem a credencial da conversa: só o dono lê
    const cfg = JSON.parse(readFileSync(file, "utf8")).mcpServers.revoada;
    expect([cfg.args.at(-1), Object.keys(cfg.env).sort(), cfg.env.REVOADA_AGENT_TOKEN]).toEqual(["--mcp", ["REVOADA_AGENT_TOKEN", "REVOADA_AGENT_URL"], token(a.id)]);
    expect(texts(await env.idle(await env.chat(reserva, "oi")))).toContain("revoada=sim");
    await env.api("settings", "POST", { agentTools: false });
    expect(texts(await env.idle(await env.chat("claude-padrao", "oi")))).toContain("revoada=nao; liberadas=padrao");
    expect((await agent(a.id, "estado")).code).toBe("desligado");
    await env.api("settings", "POST", { agentTools: true });
  }, SLOW);

  test("a ponte fala MCP: apresenta o guia e as ferramentas, e nenhuma delas aprova, apaga ou muda ajuste", async () => {
    const p = Bun.spawn(["bun", join(ROOT, "server.ts"), "--mcp"], { env: { ...process.env, REVOADA_AGENT_URL: env.origin, REVOADA_AGENT_TOKEN: "x.y" }, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    for (const m of [{ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { method: "notifications/initialized" }, { id: 2, method: "tools/list" }, { id: 3, method: "tools/call", params: { name: "estado", arguments: {} } }, { id: 4, method: "tools/call", params: { name: "apagar_tudo" } }, { id: 5, method: "nao/existe" }]) p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
    p.stdin.end();
    const lines = (await new Response(p.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
    const by = (id: number) => lines.find((l) => l.id === id);
    expect(by(1).result.instructions).toContain("# Revoada, para agentes");
    expect(by(1).result.capabilities).toEqual({ tools: {} });
    const names = by(2).result.tools.map((t: any) => t.name);
    expect(names).toEqual(["estado", "quadro_listar", "quadro_criar_tarefa", "delegar", "conversa_ler", "pedir_revisao", "agendar", "buscar_conversas", "cerebro_buscar"]);
    expect(names.some((n: string) => /permit|aprov|apag|ajust|conta|parar|decid/.test(n))).toBe(false);
    // credencial errada: erro com código, marcado como erro para o agente
    expect([by(3).result.isError, JSON.parse(by(3).result.content[0].text).code]).toEqual([true, "nao_autorizado"]);
    expect(JSON.parse(by(4).result.content[0].text).code).toBe("nao_existe");
    expect(by(5).error.code).toBe(-32601);
    expect(lines.length).toBe(5); // a notificação não tem resposta
  }, SLOW);
});

describe("o que o agente consegue fazer, de ponta a ponta", () => {
  let parent = "";

  test("pela ponte, o agente cria tarefa no quadro e delega; o que ele abre fica ligado a ele", async () => {
    parent = await env.chat("claude-padrao", `USA-REVOADA estado\nUSA-REVOADA quadro_criar_tarefa {"pedido":"escrever os testes do frete","titulo":"Testes do frete","agente":"codex"}\nUSA-REVOADA delegar {"pedido":"resuma o README","isolar":false}`, { cwd: env.repo });
    const c = await env.idle(parent);
    const said = texts(c);
    expect(said).toContain("guia=true");
    expect(said).toMatch(/estado: \{ "ok": true, "projeto": "[^"]*loja", "modo": "edit", "pode_criar": 3, "limite": 3/);
    const card = (await env.api("board")).find((x: any) => x.title === "Testes do frete");
    expect([card.by, card.state === "doing" || card.state === "review", card.target]).toEqual([parent, true, "pool:codex"]);
    const kids = (await env.api("state")).convos.map((x: any) => x.id).filter((id: string) => id !== parent);
    const mine = (await Promise.all(kids.map((id: string) => env.api(`convos/${id}`)))).filter((x: any) => x.by === parent);
    expect(mine.map((x: any) => x.title).sort()).toEqual(["Testes do frete", "↳ resuma o README"]);
    expect((await env.api(`convos/${parent}`)).spawned).toBe(2);
    expect(said).toMatch(/delegar: \{ "ok": true, "id": "\w+", "restam": 1/);
  }, SLOW);

  test("conversa_ler espera o agente delegado e devolve a resposta; a dos outros fica fora do alcance", async () => {
    const child = (await Promise.all((await env.api("state")).convos.map((x: any) => env.api(`convos/${x.id}`)))).find((x: any) => x.by === parent && x.title.startsWith("↳"));
    const r = await agent(parent, "conversa_ler", { id: child.id, esperar_segundos: 20 });
    expect([r.ok, r.estado, r.resposta.includes("olá mundo")]).toEqual([true, "pronta", true]);
    const alheia = await env.chat("claude-padrao", "conversa de outro assunto");
    await env.idle(alheia);
    expect([(await agent(parent, "conversa_ler", { id: alheia })).code, (await agent(parent, "conversa_ler", { id: "nao-existe" })).code]).toEqual(["fora_do_alcance", "nao_existe"]);
  }, SLOW);

  test("pedir_revisao: outra conta revisa quando a resposta do agente termina", async () => {
    const id = await env.chat(reserva, "CRIA-ARQUIVO\nUSA-REVOADA pedir_revisao", { cwd: env.repo, isolate: true });
    const c = await env.until(async () => { const x = await env.api(`convos/${id}`); return x.messages.length === 3 && !x.working && x; });
    expect(texts(c, 1)).toContain('pedir_revisao: { "ok": true, "quando": "assim que esta resposta terminar"');
    expect([c.messages[2].review, c.messages[2].accountId]).toEqual([true, "claude-padrao"]);
    // fora de repositório não há diff: o agente recebe um código, não um silêncio
    const solta = await env.chat("claude-padrao", "oi");
    await env.idle(solta);
    expect((await agent(solta, "pedir_revisao")).code).toBe("nao_e_repositorio");
  }, SLOW);
});

describe("as travas", () => {
  test("limite por conversa: depois dele, criar devolve limite_de_tarefas, e consultar continua valendo", async () => {
    const id = await env.chat("claude-padrao", "raiz do limite", { cwd: env.repo });
    await env.idle(id);
    expect((await agent(id, "quadro_criar_tarefa", { pedido: "um", comecar: false })).restam).toBe(2);
    expect((await agent(id, "agendar", { pedido: "dois", todo_dia_as: "09:00" })).restam).toBe(1);
    expect((await agent(id, "delegar", { pedido: "três", isolar: false })).restam).toBe(0);
    for (const tool of ["quadro_criar_tarefa", "delegar", "agendar"]) {
      const r = await agent(id, tool, { pedido: "quatro", todo_dia_as: "10:00" });
      expect([tool, r.status, r.code]).toEqual([tool, 429, "limite_de_tarefas"]);
    }
    expect((await agent(id, "estado")).pode_criar).toBe(0);
    expect((await agent(id, "quadro_listar")).ok).toBe(true);
    expect((await env.api("board")).filter((c: any) => c.by === id).length).toBe(1); // nada foi criado além do limite
  }, SLOW);

  test("agente aberto por agente não delega, e o que ele tentasse contaria no limite de quem o abriu", async () => {
    const root = await env.chat("claude-padrao", "raiz", { cwd: env.repo });
    await env.idle(root);
    const kid = (await agent(root, "delegar", { pedido: "filho", isolar: false })).id;
    await env.idle(kid);
    for (const tool of ["quadro_criar_tarefa", "delegar", "agendar"]) expect([tool, (await agent(kid, tool, { pedido: "neto", todo_dia_as: "09:00" })).code]).toEqual([tool, "sem_delegacao"]);
    expect((await agent(kid, "estado")).pode_criar).toBe(0);
    expect((await env.api(`convos/${root}`)).spawned).toBe(1);
  }, SLOW);

  test("só leitura consulta mas não cria; acesso total não passa adiante", async () => {
    const ro = await env.chat("claude-padrao", "só leitura", { cwd: env.repo, mode: "read" });
    await env.idle(ro);
    expect([(await agent(ro, "delegar", { pedido: "x" })).code, (await agent(ro, "pedir_revisao")).code, (await agent(ro, "estado")).ok]).toEqual(["somente_leitura", "somente_leitura", true]);
    const full = await env.chat("claude-padrao", "acesso total", { cwd: env.repo, mode: "full" });
    await env.idle(full);
    const kid = await env.api(`convos/${(await agent(full, "delegar", { pedido: "filho de total", isolar: false })).id}`);
    expect(kid.mode).toBe("edit");
  }, SLOW);

  test("sem credencial certa não entra, e por esta porta não se chega ao resto do painel", async () => {
    const id = await env.chat("claude-padrao", "oi");
    await env.idle(id);
    for (const tok of ["", "errada", `${id}.${"0".repeat(64)}`, token("conversa-que-nao-existe")]) expect([tok.slice(0, 12), (await agent(id, "estado", {}, tok)).code]).toEqual([tok.slice(0, 12), "nao_autorizado"]);
    for (const tool of ["decide", "settings", "accounts", "convos", "rewind", "stop", "board"]) expect([tool, (await agent(id, tool, {})).code]).toEqual([tool, "nao_existe"]);
    // a credencial de agente não vale no painel: lá continua valendo a conferência de origem
    const r = await fetch(`${env.origin}/api/settings`, { method: "POST", headers: { authorization: `Bearer ${token(id)}`, "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
    expect((await fetch(`${env.origin}/agent/estado`)).status).toBe(405);
  }, SLOW);

  test("buscar_conversas só enxerga o projeto da conversa; campo errado volta com código", async () => {
    const outra = join(env.home, "git", "financeiro"); mkdirSync(outra, { recursive: true });
    await env.idle(await env.chat("claude-padrao", "o saldo secreto é capivara-dourada", { cwd: outra }));
    await env.idle(await env.chat("claude-padrao", "aqui falamos de capivara-dourada no projeto", { cwd: env.repo }));
    const me = await env.chat("claude-padrao", "quem pergunta", { cwd: env.repo });
    await env.idle(me);
    const r = await agent(me, "buscar_conversas", { texto: "capivara-dourada" });
    expect(r.resultados.map((x: any) => x.trecho)).toEqual(["aqui falamos de capivara-dourada no projeto"]);
    expect([(await agent(me, "buscar_conversas", { texto: "ab" })).code, (await agent(me, "delegar", {})).code, (await agent(me, "delegar", { pedido: "x", agente: "gpt" })).code, (await agent(me, "agendar", { pedido: "x" })).code])
      .toEqual(["invalido", "pedido_vazio", "invalido", "invalido"]);
    // sem conta pronta do agente pedido: código próprio, pra ele tentar outro
    expect((await agent(me, "delegar", { pedido: "x", agente: "gemini" })).code).toBe("sem_conta_pronta");
  }, SLOW);
});

describe("erros com código e linha de comando", () => {
  test("o painel também responde erro com código estável", async () => {
    const bad = async (path: string, body: unknown) => (await (await fetch(`${env.origin}/api/${path}`, { method: "POST", headers: { origin: env.origin, "content-type": "application/json" }, body: JSON.stringify(body) })).json() as any).code;
    expect(await bad("chat", { prompt: "x", targets: ["claude-padrao"], cwd: "/pasta/que/nao/existe" })).toBe("pasta_nao_existe");
    expect(await bad("chat", { prompt: "x", targets: [], cwd: env.repo })).toBe("sem_conta_pronta");
    expect(await bad("chat", { prompt: "", targets: ["claude-padrao"], cwd: env.repo })).toBe("pedido_vazio");
    expect(await bad("convos/nao-existe/send", { text: "x" })).toBe("nao_existe");
    expect(await bad("board", { prompt: "", cwd: env.repo, target: "claude-padrao" })).toBe("pedido_vazio");
  });

  test("revoada pedir --esperar devolve a resposta; --json é pra máquina; os códigos de saída dizem o que houve", async () => {
    const ok = cli("pedir", "oi pela linha de comando", "--agente", "claude", "--esperar");
    expect([ok.code, ok.out.includes("olá mundo"), ok.err]).toEqual([0, true, ""]);
    const j = JSON.parse(cli("pedir", "com modelo", "--agente", "claude-padrao", "--modelo", "opus", "--esforco", "high", "--esperar", "--json").out);
    expect([j.ok, j.estado, j.resposta.includes("modelo=opus; esforco=high")]).toEqual([true, "pronta", true]);
    // a conversa nasce na pasta de onde o comando foi chamado
    expect((await env.api(`convos/${j.id}`)).cwd).toBe(realpathSync(env.repo));
    // esperando permissão: código de saída 3 e o que ele quer fazer
    const ask = cli("pedir", "crie o arquivo", "--agente", "claude", "--modo", "perguntar", "--esperar", "--json");
    const a = JSON.parse(ask.out);
    expect([ask.code, a.estado, a.permissao]).toEqual([3, "esperando_permissao", { ferramenta: "Bash", detalhe: "touch feito.txt" }]);
    await env.api(`convos/${a.id}/stop`, "POST", {});
    // agente que termina com erro: código 2 (a conta padrão do Codex de mentira está sempre no limite)
    expect(cli("pedir", "vai falhar", "--agente", "codex-padrao", "--esperar").code).toBe(2);
  }, SLOW);

  test("conversa, responder, tarefa, quadro, buscar, estado e guia", async () => {
    const id = JSON.parse(cli("pedir", "o ponto de encontro é o jacarandá", "--agente", "claude", "--json").out).id;
    expect(JSON.parse(cli("conversa", id, "--esperar", "--json").out).estado).toBe("pronta");
    expect(cli("responder", id, "mais uma", "--esperar").code).toBe(0);
    expect((await env.api(`convos/${id}`)).messages.length).toBe(4);
    const t = JSON.parse(cli("tarefa", "arrumar o rodapé\ntrocar o ícone", "--agente", "claude", "--json").out);
    expect(t.tarefas.map((x: any) => [x.titulo, x.coluna])).toEqual([["arrumar o rodapé", "todo"], ["trocar o ícone", "todo"]]);
    expect(cli("quadro").out).toContain("a fazer   arrumar o rodapé");
    expect(JSON.parse(cli("buscar", "jacarandá", "--json").out).resultados.some((r: any) => r.id === id)).toBe(true);
    expect(cli("estado").out).toContain("Contas prontas: claude/padrão desta máquina");
    expect(cli("guia").out.startsWith("# Revoada, para agentes")).toBe(true);
  }, SLOW);

  test("erro de uso sai com código entre colchetes e, em --json, como objeto", async () => {
    const e = cli("pedir");
    expect([e.code, e.err, e.out]).toEqual([1, 'erro [pedido_vazio]: faltou o pedido: revoada pedir "o que fazer"', ""]);
    expect(JSON.parse(cli("conversa", "nao-existe", "--json").out)).toEqual({ ok: false, code: "nao_existe", message: "conversa não existe" });
    expect(cli("pedir", "x", "--agente", "inexistente").err).toStartWith("erro [nao_existe]:");
    expect(cli("pedir", "x", "--pasta", "/nao/existe", "--agente", "claude").err).toBe("erro [pasta_nao_existe]: pasta não existe");
    expect(cli("voar").err).toStartWith("erro [invalido]:");
    const off = Bun.spawnSync(["bun", join(ROOT, "cli.ts"), "estado"], { env: { ...process.env, REVOADA_PORT: "1" }, stdout: "pipe", stderr: "pipe" });
    expect([off.exitCode, off.stderr.toString().startsWith("erro [revoada_fechada]:")]).toEqual([4, true]);
  }, SLOW);
});
