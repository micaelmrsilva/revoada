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
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
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
    env = await sobe(5000 + Math.floor(Math.random() * 90));
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
    await page(`document.querySelector("#msgs .acts > summary").click();`);
    await until(`document.querySelector("#msgs .acts").open && document.querySelector("#msgs .acts .what")`);
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
    await env.idle(rica); await env.idle(negada);
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
      return JSON.stringify({ rica: a, negada: measure(), live: alive, webkit: /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) });`;
    const run = Bun.spawnSync(["swift", join(import.meta.dir, "webkit.swift"), env.origin, js], { stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString().slice(-800));
    expect(JSON.parse(run.stdout.toString())).toEqual({ rica: [0, 0, 760], negada: [0, 0, 760], live: 1, webkit: true });
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
