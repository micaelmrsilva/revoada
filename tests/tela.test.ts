// Teste de tela: abre o painel de verdade num Chrome sem janela e confere o que os outros testes
// não enxergam: nada estoura a largura da conversa, a resposta chega aos poucos sem a página ficar
// perguntando, o comando não aparece repetido e a fila de mensagens funciona pelo teclado.
// Fala o protocolo de depuração do Chrome direto, sem dependência. Sem Chrome na máquina o teste
// é pulado (no GitHub, onde o Chrome vem instalado, a falta dele é erro).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sobe } from "./ambiente";

const CHROME = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ...["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map((b) => Bun.which(b))].find((p) => p && existsSync(p));
if (!CHROME && process.env.CI) throw new Error("teste de tela: não achei o Chrome nesta máquina de CI");

const SLOW = 40_000;
let env: Awaited<ReturnType<typeof sobe>>, chrome: any, ws: WebSocket, session = "", profile = "";
let seq = 0;
const waiting = new Map<number, (m: any) => void>();
const cdp = (method: string, params: object = {}, sid = session) => new Promise<any>((resolve, reject) => {
  const id = ++seq;
  // sem resposta em 20 s é defeito: melhor falhar com o nome do comando do que travar a bateria inteira
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method}: o Chrome não respondeu`)); }, 20_000);
  waiting.set(id, (m) => { clearTimeout(timer); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
});
// roda um trecho de código na página e devolve o valor
async function page<T = any>(expression: string): Promise<T> {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const until = (expr: string, ms = 15_000) => env.until(() => page<boolean>(`return !!(${expr})`), ms);
// o quanto algum pedaço da conversa passa da borda direita da coluna, e se há rolagem horizontal
const OVERFLOW = `const w = document.querySelector("#msgs"), edge = w.getBoundingClientRect().right;
  return { over: Math.round(Math.max(0, ...[...w.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right - edge))), scroll: document.querySelector("#chatScroll").scrollWidth - document.querySelector("#chatScroll").clientWidth, col: Math.round(w.getBoundingClientRect().width) };`;
const key = (k: string) => `document.querySelector("#prompt").focus(); document.querySelector("#prompt").dispatchEvent(new KeyboardEvent("keydown", { key: "${k}", bubbles: true, cancelable: true }));`;

describe.skipIf(!CHROME)("tela", () => {
  beforeAll(async () => {
    env = await sobe(5200 + Math.floor(Math.random() * 90)); // 5000 e 7000 são do AirPlay no macOS
    profile = mkdtempSync(join(tmpdir(), "revoada-chrome-"));
    chrome = Bun.spawn([CHROME!, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "--window-size=1280,860", "about:blank"], { stdout: "ignore", stderr: "pipe" });
    // o Chrome avisa no erro padrão em que endereço atende o protocolo de depuração
    let log = "";
    const url = await new Promise<string>(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`o Chrome não abriu a porta de depuração:\n${log}`)), 20_000);
      const dec = new TextDecoder();
      for await (const chunk of chrome.stderr) { log += dec.decode(chunk); const m = log.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); return resolve(m[1]); } }
    });
    ws = new WebSocket(url);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); } };
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" }, "");
    session = (await cdp("Target.attachToTarget", { targetId, flatten: true }, "")).sessionId;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await cdp("Page.enable");
    await cdp("Page.navigate", { url: env.origin });
    await until(`typeof go === "function" && typeof S === "object" && S && S.accounts`);
  }, SLOW);

  afterAll(async () => {
    try { ws?.close(); } catch {}
    chrome?.kill();
    await chrome?.exited;
    await env?.stop();
    if (profile) rmSync(profile, { recursive: true, force: true });
  });

  test("resposta longa e formatada cabe na coluna, em tela larga e estreita", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: e já foi?");
    await env.idle(id);
    await page(`await refresh(); go({ type: "chat", id: "${id}" });`);
    await until(`document.querySelector("#msgs table") && !chat.working`);
    const wide = await page(OVERFLOW);
    expect(wide).toEqual({ over: 0, scroll: 0, col: 760 });
    const seen = await page(`const m = document.querySelector("#msgs"); return { rows: m.querySelectorAll("tbody tr").length, cols: m.querySelectorAll("thead th").length, raw: /\\|\\s*---/.test(m.innerText), nested: m.querySelectorAll("li li").length, title: !!m.querySelector(".md h3"), code: !!m.querySelector(".md pre code"),
      groups: [...m.querySelectorAll(".acts")].map((d) => [d.querySelector(".lbl").textContent, d.open]) };`);
    expect(seen).toEqual({ rows: 4, cols: 2, raw: false, nested: 1, title: true, code: true, groups: [["Rodou 1 comando, leu 1 arquivo", false]] });
    // aberto, o grupo mostra o comando comprido numa linha só, cortado com reticências, sem empurrar a coluna
    console.log("DEBUG", await page(`return { view: JSON.stringify(view), msgs: document.querySelector("#msgs").innerHTML.length, acts: document.querySelectorAll("#msgs .acts").length, html: document.querySelector("#msgs").innerHTML.slice(0, 300), err: window.__err || null }`));
    await page(`document.querySelector("#msgs .acts > summary").click();`);
    await until(`document.querySelector("#msgs .acts").open && document.querySelector("#msgs .acts .what")`);
    expect(await page(OVERFLOW)).toEqual({ over: 0, scroll: 0, col: 760 });
    // cada passo é uma linha com o que o agente disse que ia fazer; o comando cru só aparece ao abrir o passo
    const steps = await page(`const g = document.querySelector("#msgs .acts"); const rows = [...g.querySelectorAll(".astep")];
      const before = rows.map((e) => (e.querySelector("summary") || e).innerText.trim());
      const boxed = rows.some((e) => parseFloat(getComputedStyle(e).borderTopWidth) > 0);
      // fechado, cada passo é uma linha baixa que ocupa a largura da lista (uma classe trocada já fez isto virar uma coluna de 44px)
      const lines = rows.every((e) => { const r = e.getBoundingClientRect(), t = (e.querySelector(".what") || e).getBoundingClientRect(); return r.height < 34 && t.width > 200; });
      g.querySelector(".astep > summary").click(); await new Promise((r) => setTimeout(r, 100));
      return { before, boxed, lines, shown: g.querySelector(".astep pre.cmdline").innerText.includes("criar-contas.sh") && g.querySelector(".astep pre.cmdline").getBoundingClientRect().height > 0 };`);
    expect(steps).toEqual({ before: ["Confere o andamento da criação da rodada r9", "Read ops/disparo/log.txt"], boxed: false, lines: true, shown: true });
    expect(await page(OVERFLOW)).toEqual({ over: 0, scroll: 0, col: 760 });
    // janela estreita: a coluna encolhe e o conteúdo acompanha
    await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 800, deviceScaleFactor: 1, mobile: false });
    await Bun.sleep(150);
    const narrow = await page(OVERFLOW);
    expect([narrow.over, narrow.scroll]).toEqual([0, 0]);
    expect(narrow.col).toBeLessThan(600);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  }, SLOW);

  test("o texto chega aos poucos, empurrado pelo servidor, sem a página ficar perguntando", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: de novo");
    await page(`performance.clearResourceTimings(); window.sizes = new Set(); go({ type: "chat", id: "${id}" });
      window.watch = setInterval(() => { const t = document.querySelector("#msgs .md"); if (t) sizes.add(t.innerText.length); }, 20);`);
    await until(`chat && chat.id === "${id}" && !chat.working && document.querySelector("#msgs table")`);
    const r = await page(`clearInterval(watch); return { steps: sizes.size, live: live.es.readyState, polls: performance.getEntriesByType("resource").filter((e) => /\\/api\\/convos\\/${id}(\\?|$)/.test(e.name)).length, text: chat.messages.at(-1).items.at(-1).text.length };`);
    expect(r.steps).toBeGreaterThan(4);   // vários tamanhos intermediários: chegou em pedaços
    expect(r.live).toBe(1);               // conexão ao vivo de pé
    expect(r.polls).toBe(0);              // nenhuma consulta de tempo em tempo
    expect(r.text).toBe((await env.api(`convos/${id}`)).messages.at(-1).items.at(-1).text.length);
  }, SLOW);

  test("pasta de caminho comprido não vaza do campo de pedido nem do cabeçalho", async () => {
    const deep = join(env.home, "Library/Application Support/Claude/scratch-workspaces/d1ab563f-8797-4857-88c3-13efdc7aa9e9/7fc5e0b6-8b05-47a9-95dd-89f14c5f7129/scratch-2026-10-07-bf0031");
    require("fs").mkdirSync(deep, { recursive: true });
    const id = await env.chat("claude-padrao", "oi", { cwd: deep });
    await env.idle(id);
    await page(`go({ type: "chat", id: "${id}" });`);
    await until(`chat && chat.id === "${id}" && document.querySelector("#dirChip span")`);
    const measure = `const chip = document.querySelector("#dirChip"), strip = chip.parentElement.getBoundingClientRect(), sub = document.querySelector("#chSub").getBoundingClientRect();
      return { fits: chip.getBoundingClientRect().right <= strip.right + 1, header: sub.right <= innerWidth, page: document.documentElement.scrollWidth <= innerWidth, text: chip.innerText.trim(), full: chip.title.endsWith("scratch-2026-10-07-bf0031") };`;
    expect(await page(measure)).toEqual({ fits: true, header: true, page: true, text: "…/scratch-2026-10-07-bf0031", full: true });
    // na menor janela que o app permite (920 de largura) continua cabendo
    await cdp("Emulation.setDeviceMetricsOverride", { width: 920, height: 700, deviceScaleFactor: 1, mobile: false });
    await Bun.sleep(150);
    const small = await page(measure);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    expect([small.fits, small.header, small.page]).toEqual([true, true, true]);
  }, SLOW);

  test("janela estreita (até 600 de largura): nada sai da tela, na conversa e no início", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: estreita");
    await env.idle(id);
    // tudo o que estiver visível e passar da borda direita da janela
    const leak = `return { doc: document.documentElement.scrollWidth - innerWidth, out: [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.right > innerWidth + 1 && !e.closest("dialog, .pop, #toast"); }).slice(0, 6).map((e) => e.tagName + "#" + e.id) };`;
    try {
      for (const width of [900, 760, 600]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: false });
        await page(`go({ type: "chat", id: "${id}" });`);
        await until(`chat && chat.id === "${id}" && document.querySelector("#msgs table")`);
        await Bun.sleep(120);
        expect([width, "conversa", await page(leak)]).toEqual([width, "conversa", { doc: 0, out: [] }]);
        // tabela e bloco de código têm rolagem própria quando não cabem; fora deles nada passa da coluna
        expect(await page(`const w = document.querySelector("#msgs"), edge = w.getBoundingClientRect().right;
          return { over: Math.round(Math.max(0, ...[...w.querySelectorAll("*")].filter((e) => !e.closest(".tbl table, pre code")).map((e) => e.getBoundingClientRect().right - edge))), scroll: document.querySelector("#chatScroll").scrollWidth - document.querySelector("#chatScroll").clientWidth };`)).toEqual({ over: 0, scroll: 0 });
        await page(`go({ type: "home" });`);
        await Bun.sleep(120);
        expect([width, "início", await page(leak)]).toEqual([width, "início", { doc: 0, out: [] }]);
      }
      // apertado, os botões do campo ficam só com o ícone e a conta continua legível
      const row = await page(`go({ type: "chat", id: "${id}" }); await new Promise((r) => setTimeout(r, 200)); const v = (q) => { const e = document.querySelector(q); return !!e && e.getBoundingClientRect().width > 0; };
        return { rotulo: v("#brainChip .lb"), icone: v("#brainChip svg"), conta: document.querySelector("#targetChip .lb").getBoundingClientRect().width > 40, enviar: v("#send") };`);
      expect(row).toEqual({ rotulo: false, icone: true, conta: true, enviar: true });
    } finally { await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }); }
    expect(await page(`return document.querySelector("#brainChip .lb").getBoundingClientRect().width > 0`)).toBe(true); // na largura normal o nome volta
  }, SLOW);

  test("agente terminou: o campo oferece o próximo pedido (Tab aceita) e os tokens abrem o raio-x", async () => {
    const id = await env.chat("claude-padrao", "diga olá");
    await env.idle(id);
    await page(`go({ type: "chat", id: "${id}" });`);
    await until(`chat && chat.id === "${id}" && chat.suggest && document.querySelector("#prompt").placeholder === chat.suggest`);
    expect(await page(`return [document.querySelector("#prompt").placeholder, document.querySelector("#notes").textContent, [...document.querySelectorAll("#chActs button")].map((b) => b.textContent)]`))
      .toEqual(["roda os testes agora", "sugestão · Tab aceita · Enter envia", ["Mudanças", "Revisar", "Segurança"]]);
    await page(key("Tab"));
    expect(await page(`return document.querySelector("#prompt").value`)).toBe("roda os testes agora");
    // começou a escrever outra coisa: a sugestão sai da frente
    await page(`const p = document.querySelector("#prompt"); p.value = ""; p.dispatchEvent(new Event("input", { bubbles: true }));`);
    await page(`document.querySelector("#msgs [data-xray]").click();`);
    await until(`document.querySelector("#msgs .xray")`);
    const x = await page(`const e = document.querySelector("#msgs .xray"); return { text: e.innerText.replace(/\\s+/g, " "), bars: e.querySelectorAll(".bar i").length };`);
    expect(x.text).toContain("de entrada");
    expect(x.text).toContain("seu pedido");
    expect(x.bars).toBeGreaterThan(1);
    expect(await page(OVERFLOW)).toEqual({ over: 0, scroll: 0, col: 760 });
    await page(`document.querySelector("#msgs [data-xray]").click();`);
    await until(`!document.querySelector("#msgs .xray")`);
  }, SLOW);

  test("agendar pelo campo: o pedido sai do campo, aparece em Agendados e some ao apagar", async () => {
    await page(`go({ type: "home" }); const p = document.querySelector("#prompt"); p.value = "relatório de vendas da semana"; p.dispatchEvent(new Event("input", { bubbles: true })); paintComposer();`);
    await until(`getComputedStyle(document.querySelector("#schedChip")).display !== "none"`);
    await page(`document.querySelector("#schedChip").click();`);
    await until(`document.querySelector("#popSched").classList.contains("on")`);
    await page(`document.querySelector('#schedKind [data-k="daily"]').click(); document.querySelector('#schedDays [data-d="1"]').click(); document.querySelector("#schedSave").click();`);
    const list = await env.until(async () => { const l = await env.api("schedules"); return l.length === 1 && l; });
    expect([list[0].prompt, list[0].kind, list[0].time, list[0].days, list[0].enabled]).toEqual(["relatório de vendas da semana", "daily", "03:00", [1], true]);
    // o servidor já tem o agendamento antes de a página receber a resposta: espera ela reagir
    await until(`document.querySelector("#prompt").value === "" && !document.querySelector("#popSched").classList.contains("on")`);
    await page(`await refresh(); go({ type: "sched" });`);
    await until(`document.querySelector("#schedList .r")`);
    expect(await page(`return [document.querySelector("#schedLead").textContent, document.querySelector("#schedList .r b").textContent, document.querySelector("#schedCount").textContent, document.querySelector("#schedList small").textContent.includes("todo dia às 03:00 (seg)")]`))
      .toEqual(["1 pedido agendado.", "relatório de vendas da semana", "1", true]);
    await page(`document.querySelector("#schedList [data-rm]").click();`);
    await until(`!document.querySelector("#schedList .r")`);
    expect(await env.api("schedules")).toEqual([]);
  }, SLOW);

  test("supervisor pela tela: plano, aprovação e tarefas até o fim", async () => {
    await page(`setCwd(${JSON.stringify("")} || "${env.repo}"); go({ type: "home" });`);
    await until(`getComputedStyle(document.querySelector("#supChip")).display !== "none"`);
    await page(`document.querySelector("#supChip").click(); const p = document.querySelector("#prompt"); p.value = "Exportação e importação da loja"; p.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#send").click();`);
    await until(`view.type === "mission" && document.querySelector('#misActs [data-m="start"]')`);
    expect(await page(`return [document.querySelector("#misLead").textContent, document.querySelector('#misActs [data-m="start"]').textContent, [...document.querySelectorAll("#misTasks .r b")].map((b) => b.textContent), [...document.querySelectorAll("#misTasks .tag")].map((b) => b.textContent)]`))
      .toEqual(["Exportação e importação da loja", "Rodar 2 tarefas", ["1. Exportação de pedidos", "2. Importação de clientes"], ["pendente", "pendente"]]);
    // na lateral, a missão que espera aprovação aparece marcada
    expect(await page(`await refresh(); return !!document.querySelector('#threads [data-open^="mission:"] .dot.wait')`)).toBe(true);
    await page(`document.querySelector('#misActs [data-m="start"]').click();`);
    await until(`mission && mission.state === "pronta" && [...document.querySelectorAll("#misTasks .tag")].every((t) => t.textContent === "pronta")`, 30_000);
    expect(await page(`return [document.querySelectorAll("#misTasks [data-conv]").length, !!document.querySelector('#misActs [data-m="merge"]'), document.documentElement.scrollWidth <= innerWidth]`)).toEqual([2, true, true]);
    await page(`setCwd("${env.home}");`);
  }, 60_000);

  test("Contas mostra skills e MCP; Cérebro mostra a arrumação", async () => {
    await page(`go({ type: "accounts" });`);
    await until(`document.querySelector("#toolsBox .switch")`);
    expect(await page(`return document.querySelector("#toolsBox").innerText.includes("Usar nas outras contas")`)).toBe(true);
    await page(`go({ type: "brain" });`);
    await until(`document.querySelector("#brainTidy .switch")`);
    expect(await page(`return document.querySelector("#brainTidy").innerText.includes("Arquivar sozinho")`)).toBe(true);
    await page(`go({ type: "home" });`);
  }, SLOW);

  test("linha de status mostra o passo em curso e o tempo; no fim sobram as ações da mensagem", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: status");
    await page(`window.seen = new Set(); window.times = new Set(); go({ type: "chat", id: "${id}" });
      window.watch = setInterval(() => { const n = document.querySelector("#msgs .working .now"), t = document.querySelector("#msgs .working .num"); if (n) seen.add(n.textContent); if (t && t.textContent) times.add(t.textContent); }, 15);`);
    await until(`chat && chat.id === "${id}" && !chat.working && document.querySelector("#msgs table")`);
    const live = await page(`clearInterval(watch); return { seen: [...seen], time: [...times].every((t) => /^\\d+ s$/.test(t)) && times.size > 0, dots: document.querySelectorAll("#msgs .working").length };`);
    expect(live.seen).toContain("Confere o andamento da criação da rodada r9"); // o passo, com as palavras do agente
    expect(live.seen).toContain("Escrevendo a resposta");
    expect([live.time, live.dots]).toEqual([true, 0]); // tempo no formato "12 s"; terminou, a linha some

    // copiar leva o texto como o agente escreveu (markdown), não o HTML
    await page(`window.copied = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { copied.push(t); } } });`);
    const acts = await page(`const ms = [...document.querySelectorAll("#msgs > .m")]; const names = (el) => [...el.querySelectorAll(".mact button")].map((b) => b.getAttribute("aria-label"));
      ms.at(-1).querySelector('[data-act="copy"]').click(); ms[0].querySelector('[data-act="copy"]').click(); await new Promise((r) => setTimeout(r, 80));
      return { user: names(ms[0]), bot: names(ms.at(-1)), table: copied[0].includes("| Conta | Registrados (de 500) |"), mine: copied[1], feedback: ms.at(-1).querySelector('[data-act="copy"] span').textContent };`);
    expect(acts).toEqual({ user: ["Copiar", "Editar"], bot: ["Copiar", "Tentar de novo"], table: true, mine: "DEMO-RICA: status", feedback: "Copiado" });
    // bloco de código ganha o botão de copiar quando o mouse passa
    expect(await page(`const pre = document.querySelector("#msgs .md pre"); pre.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); pre.querySelector("[data-copy-code]").click(); await new Promise((r) => setTimeout(r, 50)); return copied.at(-1);`)).toBe("./criar-contas.sh --rodada r9 --so-o-que-falta");
  }, SLOW);

  test("editar reescreve a mensagem no campo e volta a conversa; Esc desiste; tentar de novo refaz a resposta", async () => {
    const id = await env.chat("claude-padrao", "oi");
    await env.idle(id);
    await page(`go({ type: "chat", id: "${id}" });`);
    await until(`chat && chat.id === "${id}" && document.querySelector('#msgs [data-act="edit"]')`);
    // Esc desiste e limpa o campo
    await page(`document.querySelector('#msgs [data-act="edit"]').click();`);
    expect(await page(`return [document.querySelector("#prompt").value, !!document.querySelector("#msgs .bubble.editing"), document.querySelector("#prompt").placeholder.startsWith("Reescreva")]`)).toEqual(["oi", true, true]);
    await page(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));`);
    expect(await page(`return [document.querySelector("#prompt").value, !!document.querySelector("#msgs .bubble.editing")]`)).toEqual(["", false]);
    // editar de verdade
    await page(`document.querySelector('#msgs [data-act="edit"]').click(); const p = document.querySelector("#prompt"); p.value = "oi, com mais contexto"; p.dispatchEvent(new Event("input", { bubbles: true })); ${key("Enter")}`);
    let c = await env.until(async () => { const x = await env.api(`convos/${id}`); return x.messages[0].text === "oi, com mais contexto" && !x.working && x; });
    expect(c.messages.length).toBe(2);
    await until(`!chat.working && document.querySelector("#msgs .bubble").textContent === "oi, com mais contexto" && !document.querySelector("#msgs .bubble.editing")`);
    // tentar de novo: mesma pergunta, resposta nova
    const before = c.messages[1].at;
    await page(`document.querySelector('#msgs [data-act="retry"]').click();`);
    c = await env.until(async () => { const x = await env.api(`convos/${id}`); return x.messages.length === 2 && !x.working && x.messages[1].at > before && x; });
    expect(c.messages[0].text).toBe("oi, com mais contexto");
  }, SLOW);

  test("modelo e esforço se escolhem no campo e vão com o pedido; o anel abre janela de contexto e limites", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: uso");
    await env.idle(id);
    await page(`localStorage.removeItem("models"); for (const k of Object.keys(choice)) delete choice[k]; go({ type: "chat", id: "${id}" });`);
    await until(`chat && chat.id === "${id}" && !chat.working && document.querySelector("#modelChip .lb")`);
    expect(await page(`return document.querySelector("#modelChip .lb").textContent`)).toBe("Modelo padrão");
    await page(`document.querySelector("#modelChip").click(); document.querySelector('#popModel [data-model="opus"]').click(); document.querySelector('#popModel [data-effort="high"]').click();`);
    expect(await page(`return [document.querySelector("#modelChip .lb").textContent, [...document.querySelectorAll("#popModel [data-effort]")].map((b) => b.textContent)]`)).toEqual(["Opus · Alto", ["Padrão", "Baixo", "Médio", "Alto", "Muito alto", "Máximo"]]);
    await page(`closePops(); mode = "edit"; const p = document.querySelector("#prompt"); p.value = "com opus"; p.dispatchEvent(new Event("input", { bubbles: true })); ${key("Enter")}`);
    const c = await env.until(async () => { const x = await env.api(`convos/${id}`); return x.messages.length === 4 && !x.working && x; });
    expect([c.model, c.effort, c.messages.at(-1).model]).toEqual(["opus", "high", "claude-opus-teste"]);
    await until(`!chat.working && document.querySelector("#msgs > .m:last-child .mdl")`);
    expect(await page(`return document.querySelector("#msgs > .m:last-child .mdl").textContent`)).toBe("opus-teste");

    // painel de uso: a janela desta conversa e os limites da conta que responde
    await page(`document.querySelector("#usageChip").click();`);
    const use = await page(`const p = document.querySelector("#popUsage"); return { on: p.classList.contains("on"), rows: [...p.querySelectorAll(".u")].map((u) => u.querySelector("span").textContent + " | " + u.querySelector("small").textContent.replace(/\\s+/g, " ").trim()), fits: p.getBoundingClientRect().right <= innerWidth && p.getBoundingClientRect().left >= 0 };`);
    expect(use.on && use.fits).toBe(true);
    expect(use.rows[0]).toBe("Janela de contexto | 53,9k / 200k (27%)");
    expect(use.rows[1]).toMatch(/^Limite de sessão \| Reinicia em (5\d|60|1 h 0) min 42%$/);
    expect(use.rows[2]).toMatch(/^Semanal · todos os modelos \| Reinicia (em 23 h \d+ min|\S+,? \d\d:\d\d) 10%$/);
    await page(`closePops(); localStorage.removeItem("models"); for (const k of Object.keys(choice)) delete choice[k];`);
  }, SLOW);

  test("Esc nega, e o cartão de negado com comando comprido não alarga a conversa", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: nega esta", { mode: "ask" });
    await page(`go({ type: "chat", id: "${id}" });`);
    await until(`document.querySelector('#msgs [data-decide="deny"]')`);
    await page(key("Escape"));
    await until(`chat && !chat.working && document.querySelector("#msgs .askcard.done")`);
    expect(await page(`return document.querySelector("#msgs .askcard.done").innerText.replace(/\\s+/g, " ").slice(0, 14)`)).toBe("NEGADO Bash · ");
    // foi este cartão, com o comando numa linha só, que empurrava a coluna inteira pra fora da tela
    expect(await page(OVERFLOW)).toEqual({ over: 0, scroll: 0, col: 760 });
  }, SLOW);

  // A janela do app é um WKWebView, não um Chrome. O estouro de largura que motivou este arquivo
  // aparecia justamente ali, então as mesmas medidas são tiradas também nesse motor.
  test.skipIf(process.platform !== "darwin" || !Bun.which("swift"))("no motor do app (WebKit): conversa ao vivo de pé e nada estoura a coluna", async () => {
    const rica = await env.chat("claude-padrao", "DEMO-RICA: webkit");
    const negada = await env.chat("claude-padrao", "DEMO-RICA: webkit nega", { mode: "ask" });
    const w = await env.until(async () => { const c = await env.api(`convos/${negada}`); return c.waiting && c; });
    await env.api(`convos/${negada}/decide`, "POST", { req: w.messages.at(-1).items.find((i: any) => i.kind === "ask").req, decision: "deny" });
    const deep = join(env.home, "Library/Application Support/Claude/scratch-workspaces/d1ab563f-8797-4857-88c3-13efdc7aa9e9/7fc5e0b6-8b05-47a9-95dd-89f14c5f7129/scratch-webkit");
    require("fs").mkdirSync(deep, { recursive: true });
    const funda = await env.chat("claude-padrao", "oi", { cwd: deep });
    await env.idle(rica); await env.idle(negada); await env.idle(funda);
    const js = `
      const wait = async (f) => { for (let i = 0; i < 200; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 60)); } throw new Error("esperei demais"); };
      const measure = () => { const w = document.querySelector("#msgs"), edge = w.getBoundingClientRect().right; return [Math.round(Math.max(0, ...[...w.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right - edge))), document.querySelector("#chatScroll").scrollWidth - document.querySelector("#chatScroll").clientWidth, Math.round(w.getBoundingClientRect().width)]; };
      await wait(() => typeof go === "function" && typeof S === "object" && S && S.accounts);
      go({ type: "chat", id: "${rica}" });
      await wait(() => chat && chat.id === "${rica}" && !chat.working && document.querySelector("#msgs table"));
      document.querySelector("#msgs .acts > summary").click();
      await wait(() => document.querySelector("#msgs .acts").open);
      const a = measure(), alive = live.es.readyState;
      go({ type: "chat", id: "${negada}" });
      await wait(() => chat && chat.id === "${negada}" && !chat.working && document.querySelector("#msgs .askcard.done"));
      const b = measure();
      go({ type: "chat", id: "${funda}" });
      await wait(() => chat && chat.id === "${funda}" && document.querySelector("#dirChip span"));
      const chip = document.querySelector("#dirChip");
      const pasta = chip.getBoundingClientRect().right <= chip.parentElement.getBoundingClientRect().right + 1 && document.documentElement.scrollWidth <= innerWidth;
      return JSON.stringify({ rica: a, negada: b, pasta, live: alive, webkit: /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) });`;
    const run = Bun.spawnSync(["swift", join(import.meta.dir, "webkit.swift"), env.origin, js], { stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString().slice(-800));
    expect(JSON.parse(run.stdout.toString())).toEqual({ rica: [0, 0, 760], negada: [0, 0, 760], pasta: true, live: 1, webkit: true });
    // e com a janela em 600 de largura: nada passa da borda, e os botões do campo ficam só com o ícone
    const narrow = Bun.spawnSync(["swift", join(import.meta.dir, "webkit.swift"), env.origin, `
      const wait = async (f) => { for (let i = 0; i < 200; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 60)); } throw new Error("esperei demais"); };
      await wait(() => typeof go === "function" && typeof S === "object" && S && S.accounts);
      go({ type: "chat", id: "${rica}" });
      await wait(() => chat && chat.id === "${rica}" && document.querySelector("#msgs table"));
      await new Promise((r) => setTimeout(r, 200));
      const out = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.right > innerWidth + 1 && !e.closest("dialog, .pop, #toast"); }).slice(0, 6).map((e) => e.tagName + "#" + e.id);
      return JSON.stringify({ width: innerWidth, doc: document.documentElement.scrollWidth - innerWidth, out, rotulo: document.querySelector("#brainChip .lb").getBoundingClientRect().width > 0 });`, "600"], { stdout: "pipe", stderr: "pipe" });
    if (narrow.exitCode !== 0) throw new Error(narrow.stderr.toString().slice(-800));
    expect(JSON.parse(narrow.stdout.toString())).toEqual({ width: 600, doc: 0, out: [], rotulo: false });
  }, 90_000);

  test("pedido de permissão mostra o comando uma vez; Enter com texto põe na fila, Enter vazio permite", async () => {
    const id = await env.chat("claude-padrao", "DEMO-RICA: retoma", { mode: "ask" });
    await page(`go({ type: "chat", id: "${id}" });`);
    await until(`document.querySelector('#msgs [data-decide="allow"]')`);
    const card = await page(`const t = document.querySelector("#msgs").innerText; return { times: t.split("criar-contas.sh").length - 1, hint: document.querySelector("#prompt").placeholder };`);
    expect(card.times).toBe(1);
    expect(card.hint).toContain("Enter permite");
    expect(await page(OVERFLOW)).toEqual({ over: 0, scroll: 0, col: 760 });

    // escreve a próxima enquanto o agente espera: vai pra fila, e o agente continua parado esperando
    await page(`const p = document.querySelector("#prompt"); p.value = "segunda mensagem"; p.dispatchEvent(new Event("input", { bubbles: true })); ${key("Enter")}`);
    await until(`document.querySelector("#queued .bubble")`);
    let c = await env.api(`convos/${id}`);
    expect(c.queue.map((q: any) => q.text)).toEqual(["segunda mensagem"]);
    expect([c.working, c.waiting, c.messages.length]).toEqual([true, true, 2]);
    expect(await page(`return [document.querySelector("#queued").innerText.includes("segunda mensagem"), document.querySelector("#prompt").value, document.querySelector("#send").classList.contains("stop")]`)).toEqual([true, "", true]);

    // Enter com o campo vazio permite; ao terminar, a mensagem da fila entra sozinha
    await page(key("Enter"));
    c = await env.until(async () => { const x = await env.api(`convos/${id}`); return x.messages.length === 4 && x; });
    expect(c.messages[2].text).toBe("segunda mensagem");
    expect(c.queue).toBeUndefined();
    await until(`!document.querySelector("#queued .bubble") && document.querySelectorAll("#msgs > .m").length === 4`);
    await env.api(`convos/${id}/stop`, "POST", {});
  }, SLOW);
});
