// Quadro de tarefas, plano em arquivo, busca no conteúdo e modelo automático.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { sobe } from "./ambiente";
import { classify, route } from "../route";

let env: Awaited<ReturnType<typeof sobe>>;
const SLOW = 40_000;
const texts = (c: any, i = -1) => c.messages.at(i).items.filter((x: any) => x.kind === "text").map((x: any) => x.text).join(" ");
const post = (path: string, body: unknown = {}) => fetch(`${env.origin}/api/${path}`, { method: "POST", headers: { origin: env.origin, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) as any }));

beforeAll(async () => { env = await sobe(); }, SLOW);
afterAll(async () => { await env?.stop(); });

describe("quadro de tarefas", () => {
  let reserva = "", cards: any[] = [];
  const board = () => env.api("board");
  const card = async (id: string) => (await board()).find((c: any) => c.id === id);

  test("várias tarefas de uma vez viram um cartão cada, na primeira coluna", async () => {
    reserva = (await env.api("accounts", "POST", { provider: "codex", label: "reserva" })).id;
    await env.api("state?refresh=1");
    cards = (await post("board", { prompt: "- CRIA-ARQUIVO do relatório\n2. só conversa sobre o design\n\n* terceira tarefa", cwd: env.repo, target: reserva, split: true })).body;
    expect(cards.map((c: any) => [c.title, c.state])).toEqual([["CRIA-ARQUIVO do relatório", "todo"], ["só conversa sobre o design", "todo"], ["terceira tarefa", "todo"]]);
    expect((await env.api("state")).board).toBe(3);
    expect((await post("board", { prompt: "", cwd: env.repo, target: reserva })).status).toBe(400);
    expect((await post("board", { prompt: "x", cwd: env.repo, target: "conta-que-nao-existe" })).status).toBe(400);
  }, SLOW);

  test("começar abre um agente numa cópia própria; ao terminar o cartão vai sozinho para revisar e outra conta revisa", async () => {
    const [a, b] = cards;
    await post(`board/${a.id}/start`);
    await post(`board/${b.id}/move`, { to: "doing" }); // arrastar para "Fazendo" é o mesmo que começar
    const done = await env.until(async () => { const l = await board(); const x = l.find((c: any) => c.id === a.id), y = l.find((c: any) => c.id === b.id); return x.state === "review" && y.state === "review" && !x.working && !y.working && [x, y]; });
    const [ca, cb] = await Promise.all(done.map((c: any) => env.api(`convos/${c.convo}`)));
    // cada tarefa numa cópia isolada do repositório, não na pasta principal
    expect(ca.worktree.branch.startsWith("revoada/")).toBe(true);
    expect(ca.cwd).not.toBe(cb.cwd);
    expect(existsSync(join(ca.cwd, "novo.txt"))).toBe(true);
    expect(existsSync(join(env.repo, "novo.txt"))).toBe(false);
    // a que mexeu em arquivo foi revisada por outra conta; a que só conversou, não
    expect([ca.messages.at(-1).review, ca.messages.at(-1).accountId]).toEqual([true, "claude-padrao"]);
    expect(cb.messages.some((m: any) => m.review)).toBe(false);
  }, SLOW);

  test("começar não devolve o cartão enquanto a conversa ainda está sendo aberta", async () => {
    // várias de uma vez, cada uma criando a sua cópia do repositório: o relógio do quadro passa no meio
    const many = (await post("board", { prompt: Array.from({ length: 6 }, (_, i) => `tarefa paralela ${i}`).join("\n"), cwd: env.repo, target: reserva, split: true })).body;
    await Promise.all(many.map((c: any) => post(`board/${c.id}/start`)));
    await Bun.sleep(1800);
    const now = (await board()).filter((c: any) => many.some((m: any) => m.id === c.id));
    expect(now.filter((c: any) => c.state === "todo").map((c: any) => c.note)).toEqual([]);
    expect(now.every((c: any) => c.convo)).toBe(true);
    for (const c of many) await fetch(`${env.origin}/api/board/${c.id}`, { method: "DELETE", headers: { origin: env.origin } });
  }, SLOW);

  test("o que pode e o que não pode ser arrastado", async () => {
    const [a, , c] = cards;
    expect((await post(`board/${c.id}/move`, { to: "done" })).body.error).toContain("ainda não foi feita");
    expect((await post(`board/${a.id}/move`, { to: "review" })).status).toBe(200); // já está lá: nada muda
    expect((await post(`board/${c.id}/move`, { to: "review" })).body.error).toContain("sozinho");
    expect((await post(`board/${a.id}/start`)).body.error).toContain("já foi começado");
    await post(`board/${a.id}/move`, { to: "done" });
    expect((await card(a.id)).state).toBe("done");
    // de volta para "a fazer": o cartão solta a conversa e pode ser refeito
    await post(`board/${a.id}/move`, { to: "todo" });
    expect([(await card(a.id)).state, (await card(a.id)).convo]).toEqual(["todo", undefined]);
    expect((await env.api("state")).board).toBe(3);
  }, SLOW);

  test("apagar a conversa devolve o cartão; tirar o cartão não apaga a conversa", async () => {
    const [, b] = cards, convo = (await card(b.id)).convo;
    await fetch(`${env.origin}/api/convos/${convo}`, { method: "DELETE", headers: { origin: env.origin } });
    const back = await env.until(async () => { const x = await card(b.id); return x.state === "todo" && x; });
    expect(back.note).toContain("apagada");
    const c = cards[2];
    await post(`board/${c.id}/start`);
    const run = await env.until(async () => { const x = await card(c.id); return x.state === "review" && !x.working && x; });
    await fetch(`${env.origin}/api/board/${c.id}`, { method: "DELETE", headers: { origin: env.origin } });
    expect(await card(c.id)).toBeUndefined();
    expect((await env.api(`convos/${run.convo}`)).id).toBe(run.convo);
  }, SLOW);
});

describe("plano em arquivo", () => {
  test("o agente recebe as instruções, escreve o plano fora do repositório e o progresso aparece", async () => {
    const id = (await post("chat", { prompt: "tarefa longa", targets: ["claude-padrao"], cwd: env.repo, brain: false, mode: "edit", plan: true })).body.id;
    let c = await env.idle(id);
    expect(texts(c)).toContain("plano=instruido; viu-plano=false");
    let p = await env.api(`convos/${id}/plan`);
    expect([p.on, p.done, p.total]).toEqual([true, 0, 3]);
    expect(p.file.startsWith(join(env.home, ".revoada/plans/"))).toBe(true);
    expect(existsSync(join(env.repo, `${id}.md`))).toBe(false);

    // mesma sessão: não repete as instruções a cada mensagem
    await env.api(`convos/${id}/send`, "POST", { text: "segue" });
    c = await env.idle(id);
    expect(texts(c)).toContain("retomada=true");
    expect(texts(c)).toContain("plano=nao");

    // sessão nova (aqui, por tentar de novo): recebe as instruções outra vez, agora com o plano como está
    await env.api(`convos/${id}/rewind`, "POST", { index: 2 });
    c = await env.idle(id);
    expect(texts(c)).toContain("retomada=false");
    expect(texts(c)).toContain("plano=instruido; viu-plano=true");
    p = await env.api(`convos/${id}/plan`);
    expect([p.done, p.total]).toEqual([1, 3]);
    expect(readFileSync(p.file, "utf8")).toContain("- [x] primeiro");
  }, SLOW);

  test("liga no meio da conversa e desliga sem apagar o arquivo", async () => {
    const id = await env.chat("claude-padrao", "começa sem plano");
    expect(texts(await env.idle(id))).toContain("plano=nao");
    expect((await post(`convos/${id}/plan`, { on: true })).body.on).toBe(true);
    await env.api(`convos/${id}/send`, "POST", { text: "agora com plano" });
    // a sessão é retomada, então as instruções vão na frente do pedido
    const c = await env.idle(id);
    expect(texts(c)).toContain("retomada=true");
    expect(texts(c)).toContain("plano=instruido");
    const file = (await env.api(`convos/${id}/plan`)).file;
    expect((await post(`convos/${id}/plan`, { on: false })).body.on).toBe(false);
    expect(existsSync(file)).toBe(true);
    await env.api(`convos/${id}/send`, "POST", { text: "sem plano de novo" });
    expect(texts(await env.idle(id))).toContain("plano=nao");
  }, SLOW);
});

describe("busca no conteúdo", () => {
  test("acha o que foi dito por você e pelo agente, com o trecho em volta", async () => {
    const id = await env.chat("claude-padrao", "preciso do relatório de ornitorrincos até sexta");
    await env.idle(id);
    let r = await env.api(`search?q=${encodeURIComponent("ORNITORRINCOS")}`);
    expect(r.chats.map((h: any) => [h.id, h.who])).toEqual([[id, "você"]]);
    expect(r.chats[0].snippet).toContain("relatório de ornitorrincos até sexta");
    // texto que só existe na resposta do agente
    r = await env.api(`search?q=${encodeURIComponent("olá mundo; imagens")}`);
    expect(r.chats.some((h: any) => h.id === id && h.who === "agente")).toBe(true);
    expect((await env.api("search?q=zz")).chats).toEqual([]); // curto demais: nem procura
    expect((await env.api(`search?q=${encodeURIComponent("texto que ninguém escreveu 9f3")}`)).chats).toEqual([]);
  }, SLOW);
});

describe("modelo automático", () => {
  test("o porte sai do pedido, por regras à vista", () => {
    const leve = ["qual é a versão do bun?", "lista os arquivos de teste", "roda os testes", "faz o commit", "ok", "pode", "resume o que mudou"];
    const pesado = ["refatora o módulo de cobrança pra separar cálculo de envio", "investiga por que o webhook duplica eventos", "audita a segurança das rotas de upload", "por que a fila trava com mais de 200 itens?", "planeja a migração do banco pra Postgres", "x ".repeat(200)];
    const medio = ["adiciona um campo de telefone no cadastro e valida o formato", "cria o endpoint de exportação em CSV", "troca o botão de enviar por um com ícone e ajusta o espaçamento"];
    for (const p of leve) expect([p, classify(p)]).toEqual([p, "leve"]);
    for (const p of pesado) expect([p.slice(0, 40), classify(p)]).toEqual([p.slice(0, 40), "pesado"]);
    for (const p of medio) expect([p, classify(p)]).toEqual([p, "medio"]);
    // pergunta curta com anexo não é leve: tem um print pra ler
    expect(classify("qual é o erro?", { attachments: 1 })).toBe("medio");
    expect(route("claude", "roda os testes")).toEqual({ tier: "leve", model: "haiku" });
    expect(route("claude", "refatora o parser")).toEqual({ tier: "pesado", model: "opus", effort: "high" });
    expect(route("codex", "refatora o parser")).toEqual({ tier: "pesado", effort: "high" });
    expect(route("gemini", "refatora o parser")).toEqual({ tier: "pesado" }); // sem tabela: padrão da conta
  });

  test("com Automático, cada pedido vai no modelo do seu porte e a resposta diz qual foi", async () => {
    const id = await env.chat("claude-padrao", "roda os testes", { model: "auto" });
    let c = await env.idle(id);
    expect(texts(c)).toContain("modelo=haiku; esforco=padrao");
    expect([c.model, c.messages.at(-1).routed, c.messages.at(-1).model]).toEqual(["auto", "leve", "claude-haiku-teste"]);
    await env.api(`convos/${id}/send`, "POST", { text: "investiga por que o login falha em produção e propõe a correção" });
    c = await env.idle(id);
    expect(texts(c)).toContain("modelo=opus; esforco=high");
    expect(c.messages.at(-1).routed).toBe("pesado");
    // o esforço escolhido à mão não vale no automático: quem decide é o porte
    await env.api(`convos/${id}/send`, "POST", { text: "ok", effort: "max" });
    expect(texts(await env.idle(id))).toContain("modelo=haiku; esforco=padrao");
    const provs = Object.fromEntries((await env.api("state")).providers.map((p: any) => [p.id, p.auto]));
    expect(provs).toEqual({ claude: true, codex: true, gemini: false, grok: false });
  }, SLOW);

  test("o que a Revoada põe em volta do pedido (cérebro, histórico) não muda o porte", async () => {
    const reserva = (await env.api("state")).accounts.find((a: any) => a.label === "reserva").id;
    const id = await env.chat("claude-padrao", "investiga por que o deploy quebra e refatora o script", { model: "auto" });
    await env.idle(id);
    // troca de provedor: o histórico comprido vai na frente do pedido, mas quem conta é o "ok"
    await env.api(`convos/${id}/send`, "POST", { text: "ok", target: reserva, model: "auto" });
    const c = await env.idle(id);
    expect(texts(c)).toContain("historico=true");
    expect(texts(c)).toContain("esforco=low");
    expect(c.messages.at(-1).routed).toBe("leve");
  }, SLOW);
});
