// Modelo e esforço por conversa, e o que alimenta o painel de uso (janela de contexto, modelo que respondeu).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sobe } from "./ambiente";

let env: Awaited<ReturnType<typeof sobe>>;
const SLOW = 30_000;
const texts = (c: any, i = -1) => c.messages.at(i).items.filter((x: any) => x.kind === "text").map((x: any) => x.text).join(" ");

beforeAll(async () => { env = await sobe(5400 + Math.floor(Math.random() * 90)); }, SLOW);
afterAll(async () => { await env?.stop(); });

describe("modelo e esforço", () => {
  let id = "", reserva = "";

  test("sem escolha, o CLI roda no padrão da conta; com escolha, recebe modelo e esforço", async () => {
    const plain = await env.idle(await env.chat("claude-padrao", "oi"));
    expect(texts(plain)).toContain("modelo=padrao; esforco=padrao");
    expect([plain.model, plain.effort]).toEqual([undefined, undefined]);
    id = await env.chat("claude-padrao", "oi", { model: "opus", effort: "high" });
    const c = await env.idle(id);
    expect(texts(c)).toContain("modelo=opus; esforco=high");
    expect([c.model, c.effort]).toEqual(["opus", "high"]);
    // o estado diz que esforço cada provedor aceita, pra página só oferecer o que existe
    const provs = Object.fromEntries((await env.api("state")).providers.map((p: any) => [p.id, p.efforts]));
    expect(provs).toEqual({ claude: ["low", "medium", "high", "xhigh", "max"], codex: ["low", "medium", "high"], gemini: [], grok: [] });
  }, SLOW);

  test("a escolha fica na conversa, muda a pedido, e null volta ao padrão", async () => {
    await env.api(`convos/${id}/send`, "POST", { text: "de novo" });
    expect(texts(await env.idle(id))).toContain("modelo=opus; esforco=high");
    await env.api(`convos/${id}/send`, "POST", { text: "troca", model: "sonnet", effort: "max" });
    expect(texts(await env.idle(id))).toContain("retomada=true; modelo=sonnet; esforco=max"); // trocar de modelo não perde a sessão
    await env.api(`convos/${id}/send`, "POST", { text: "padrão", model: null, effort: null });
    const c = await env.idle(id);
    expect(texts(c)).toContain("modelo=padrao; esforco=padrao");
    expect([c.model, c.effort]).toEqual([undefined, undefined]);
  }, SLOW);

  test("valor inválido é ignorado, e nada do que a página manda vira argumento solto", async () => {
    for (const bad of ["--dangerously-skip-permissions", "opus; rm -rf x", "a b", "x".repeat(90), 42, { a: 1 }]) {
      const c = await env.idle(await env.chat("claude-padrao", "oi", { model: bad, effort: "turbo" }));
      expect([bad, texts(c).includes("modelo=padrao; esforco=padrao"), c.model, c.effort]).toEqual([bad, true, undefined, undefined]);
    }
    const ok = await env.idle(await env.chat("claude-padrao", "oi", { model: "claude-opus-5-5[1m]" }));
    expect(texts(ok)).toContain("modelo=claude-opus-5-5[1m]");
  }, SLOW);

  test("trocar de provedor sem escolher de novo volta ao padrão; cada um recebe no formato dele", async () => {
    reserva = (await env.api("accounts", "POST", { provider: "codex", label: "reserva" })).id;
    await env.api("state?refresh=1");
    await env.api(`convos/${id}/send`, "POST", { text: "com opus", model: "opus", effort: "xhigh" });
    await env.idle(id);
    // "opus" e "xhigh" são do Claude: não podem seguir para o Codex
    await env.api(`convos/${id}/send`, "POST", { text: "agora no codex", target: reserva });
    let c = await env.idle(id);
    expect(texts(c)).toContain("modelo=padrao; esforco=padrao");
    await env.api(`convos/${id}/send`, "POST", { text: "codex escolhido", target: reserva, model: "gpt-teste", effort: "low" });
    c = await env.idle(id);
    expect(texts(c)).toContain("modelo=gpt-teste; esforco=low");
    // esforço que o provedor não tem (max é só do Claude) não vai
    await env.api(`convos/${id}/send`, "POST", { text: "esforço de outro", target: reserva, model: "gpt-teste", effort: "max" });
    expect(texts(await env.idle(id))).toContain("modelo=gpt-teste; esforco=padrao");
  }, SLOW);

  test("mensagem na fila leva a escolha feita quando foi escrita", async () => {
    const q = await env.chat("claude-padrao", "DEMO-RICA devagar", { model: "opus" });
    expect((await env.api(`convos/${q}/send`, "POST", { text: "depois", model: "haiku", effort: "low" })).queued).toBe(true);
    const c = await env.until(async () => { const x = await env.api(`convos/${q}`); return x.messages.length === 4 && !x.working && x; });
    expect(texts(c)).toContain("modelo=haiku; esforco=low");
  }, SLOW);
});

describe("o que o painel de uso mostra", () => {
  test("cada resposta guarda o modelo que respondeu e quanto da janela a conversa ocupa", async () => {
    const c = await env.idle(await env.chat("claude-padrao", "oi", { model: "opus" }));
    const m = c.messages.at(-1);
    expect(m.model).toBe("claude-opus-teste");
    expect(m.ctx).toEqual({ used: 53_900, window: 200_000 }); // a janela é a do modelo principal, não a do auxiliar
    const rich = (await env.idle(await env.chat("claude-padrao", "DEMO-RICA: janela"))).messages.at(-1);
    expect(rich.ctx).toEqual({ used: 535_900, window: 1_000_000 });
    // e a conta informa as janelas de limite com a hora em que renovam
    const acc = (await env.api("state")).accounts.find((a: any) => a.id === "claude-padrao");
    expect(acc.usage.map((u: any) => [u.key, u.pct, u.resetsAt > Date.now()])).toEqual([["five_hour", 42, true], ["seven_day", 10, true]]);
  }, SLOW);

  test("a revisão por outra conta não mexe no modelo escolhido nem leva a escolha", async () => {
    const reserva = (await env.api("state")).accounts.find((a: any) => a.label === "reserva").id;
    const id = await env.chat(reserva, "CRIA-ARQUIVO", { cwd: env.repo, isolate: true, model: "gpt-teste", effort: "high" });
    await env.idle(id);
    await env.api(`convos/${id}/review`, "POST", {});
    const c = await env.idle(id);
    expect(c.messages.at(-1).review).toBe(true);
    expect(texts(c)).toContain("modelo=padrao; esforco=padrao"); // o revisor (Claude) não recebe o modelo do Codex
    expect([c.model, c.effort]).toEqual(["gpt-teste", "high"]);
  }, SLOW);
});

describe("tentar de novo e editar", () => {
  test("volta a conversa ao ponto da mensagem, manda de novo e começa sessão nova com o que ficou", async () => {
    const reserva = (await env.api("state")).accounts.find((a: any) => a.label === "reserva").id;
    const id = await env.chat(reserva, "primeira");
    await env.idle(id);
    await env.api(`convos/${id}/send`, "POST", { text: "segunda" });
    let c = await env.idle(id);
    expect(c.messages.map((m: any) => m.text || "resposta")).toEqual(["primeira", "resposta", "segunda", "resposta"]);
    expect(texts(c)).toContain("retomei");

    // tentar de novo a última: a resposta antiga sai, o pedido é o mesmo, e o agente recebe o histórico em vez de retomar
    await env.api(`convos/${id}/rewind`, "POST", { index: 2 });
    c = await env.idle(id);
    expect(c.messages.map((m: any) => m.text || "resposta")).toEqual(["primeira", "resposta", "segunda", "resposta"]);
    expect(texts(c)).toContain("nova; historico=true");

    // editar a primeira: tudo o que veio depois sai, e não sobra histórico pra mandar
    await env.api(`convos/${id}/rewind`, "POST", { index: 0, text: "primeira, corrigida" });
    c = await env.idle(id);
    expect(c.messages.map((m: any) => m.text || "resposta")).toEqual(["primeira, corrigida", "resposta"]);
    expect(texts(c)).toContain("nova; historico=false");
  }, SLOW);

  test("só volta a mensagem do usuário, com texto, e com o agente parado", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA devagar");
    const busy = await fetch(`${env.origin}/api/convos/${id}/rewind`, { method: "POST", headers: { origin: env.origin, "content-type": "application/json" }, body: JSON.stringify({ index: 0 }) });
    expect([busy.status, (await busy.json() as any).error]).toEqual([400, "o agente ainda está respondendo"]);
    await env.idle(id);
    for (const body of [{ index: 1 }, { index: 9 }, { index: 0, text: "   " }]) {
      const r = await fetch(`${env.origin}/api/convos/${id}/rewind`, { method: "POST", headers: { origin: env.origin, "content-type": "application/json" }, body: JSON.stringify(body) });
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect((await env.api(`convos/${id}`)).messages.length).toBe(2); // nada foi cortado nas tentativas recusadas
  }, SLOW);
});
