// Acompanhar pelo celular: uma segunda porta, na rede, com uma API bem menor que a do painel.
// O painel (que abre shell, cria conta e mexe em ajustes) continua só em 127.0.0.1. Daqui dá pra
// ver as conversas e os limites, permitir ou negar um pedido, parar um agente e, se o usuário
// ligar, mandar mensagem numa conversa que já existe. Nada além disso.
// Sem TLS: o código de acesso viaja em claro, então é pra rede de confiança (casa, Tailscale).
import { timingSafeEqual } from "crypto";
import { chmodSync, readFileSync, writeFileSync } from "fs";
import { hostname, networkInterfaces } from "os";
import { basename, join } from "path";
import qrcode from "qrcode-generator";
import type { Convo, Item, Msg } from "./convos";

const MAX_FAILS = 8;
const LOCK_MS = 10 * 60_000;
const MSGS = 30;       // últimas mensagens de cada conversa
const TEXT_CHARS = 6000;
const OUT_CHARS = 1500;

type Account = { name: string; ok: boolean; limitUntil: number | null; usage: { key: string; pct: number }[] };

export function createRemote(d: {
  port: number; file: string; publicDir: string;
  accounts: () => Account[];
  accName: (id: string | null | undefined) => string;
  convos: () => { id: string; title: string; cwd: string; at: number; working: boolean; waiting: boolean; accountId: string | null }[];
  convo: (id: string) => Convo | undefined;
  decide: (id: string, req: string, allow: boolean) => void;
  stop: (id: string) => void;
  send: (c: Convo, text: string) => void;
  canSend: () => boolean;
}) {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let token: string = (() => { try { return JSON.parse(readFileSync(d.file, "utf8")).token || ""; } catch { return ""; } })();
  const fails = new Map<string, { n: number; until: number }>();

  function newToken() {
    token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
    writeFileSync(d.file, JSON.stringify({ token }));
    chmodSync(d.file, 0o600);
    fails.clear();
  }
  const matches = (given: string) => {
    const a = Buffer.from(given), b = Buffer.from(token);
    return !!token && a.length === b.length && timingSafeEqual(a, b);
  };

  const clip = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "\n[…]" : t; };
  // o celular recebe o suficiente pra acompanhar e decidir, não a saída inteira de cada comando
  function slimItem(it: Item) {
    if (it.kind === "text") return { k: it.k, kind: it.kind, text: clip(it.text, TEXT_CHARS) };
    if (it.kind === "note") return { k: it.k, kind: it.kind, text: it.text, tone: it.tone };
    if (it.kind === "ask") return { k: it.k, kind: it.kind, req: it.req, tool: it.tool, detail: clip(it.detail, OUT_CHARS), state: it.state };
    if (it.kind === "cmd") return { k: it.k, kind: it.kind, command: clip(it.command, 400), desc: it.desc, exit: it.exit, status: it.status, output: clip(it.output, OUT_CHARS) };
    if (it.kind === "files") return { k: it.k, kind: it.kind, changes: it.changes.map((c) => ({ path: basename(c.path), kind: c.kind })) };
    if (it.kind === "tool") return { k: it.k, kind: it.kind, name: it.name, detail: clip(it.detail, 200), status: it.status };
    if (it.kind === "todo") return { k: it.k, kind: it.kind, items: it.items };
    return null; // raciocínio não vai
  }
  const slimMsg = (m: Msg) => ({
    role: m.role, at: m.at, endedAt: m.endedAt, state: m.state, error: m.error, review: m.review,
    text: m.role === "user" ? clip(m.text, TEXT_CHARS) : undefined,
    who: m.role === "assistant" ? d.accName(m.accountId) : undefined,
    attachments: m.attachments?.length || 0,
    items: (m.items || []).map(slimItem).filter(Boolean),
  });

  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  const fail = (msg: string, status = 400) => json({ error: msg }, status);

  async function handle(req: Request, ip: string): Promise<Response> {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "GET" && (path === "/" || path === "/m")) {
      return new Response(Bun.file(join(d.publicDir, "remoto.html")), { headers: { ...headers, "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" } });
    }
    if (req.method === "GET" && (path === "/icon.svg" || path === "/logo.svg" || path === "/md.js")) return new Response(Bun.file(join(d.publicDir, path)), { headers });
    if (!path.startsWith("/r/")) return new Response("not found", { status: 404, headers });

    const lock = fails.get(ip);
    if (lock && lock.until > Date.now()) return fail("muitas tentativas com código errado; espere alguns minutos", 429);
    const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!matches(given)) {
      const n = (lock && lock.until === 0 ? lock.n : 0) + 1;
      fails.set(ip, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      return fail("código de acesso inválido", 401);
    }
    fails.delete(ip);

    const [, , resource, id, action] = path.split("/");
    if (resource === "state" && req.method === "GET") {
      return json({ host: hostname().replace(/\.local$/, ""), canSend: d.canSend(), accounts: d.accounts(), convos: d.convos().map((c) => ({ ...c, cwd: basename(c.cwd), who: d.accName(c.accountId) })) });
    }
    if (resource === "convos") {
      const c = d.convo(id || "");
      if (!c) return fail("conversa não existe", 404);
      if (req.method === "GET") {
        if (url.searchParams.get("rev") === String(c.rev)) return json({ rev: c.rev, same: true });
        return json({ id: c.id, title: c.title, cwd: basename(c.cwd), rev: c.rev, working: c.working, waiting: !!c.waiting, mode: c.mode, skipped: Math.max(0, c.messages.length - MSGS), messages: c.messages.slice(-MSGS).map(slimMsg) });
      }
      if (req.method !== "POST") return fail("rota não existe", 404);
      const body: any = await req.json().catch(() => ({}));
      try {
        if (action === "decide") { d.decide(c.id, String(body.req || ""), body.decision === "allow"); return json({ ok: true }); }
        if (action === "stop") { d.stop(c.id); return json({ ok: true }); }
        if (action === "send") {
          if (!d.canSend()) return fail("mandar mensagem pelo celular está desligado no painel", 403);
          const text = String(body.text || "").trim().slice(0, 20_000);
          if (!text) return fail("escreva a mensagem");
          d.send(c, text);
          return json({ ok: true });
        }
      } catch (e: any) { return fail(e.message); }
    }
    return fail("rota não existe", 404);
  }

  // endereços desta máquina na rede: o de casa primeiro, depois o do Tailscale
  function addresses() {
    const out: { label: string; ip: string }[] = [];
    for (const [name, list] of Object.entries(networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
        const tail = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address);
        out.push({ label: tail ? "Tailscale (de qualquer lugar)" : `Mesma rede (${name})`, ip: a.address });
      }
    }
    return out.sort((a, b) => Number(a.label.startsWith("Tailscale")) - Number(b.label.startsWith("Tailscale")));
  }
  function qr(text: string) {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  return {
    get on() { return !!server; },
    start() {
      if (server) return;
      if (!token) newToken();
      server = Bun.serve({
        hostname: "0.0.0.0", port: d.port,
        fetch: (req, srv) => handle(req, srv.requestIP(req)?.address || "?"),
      });
    },
    stop() { server?.stop(true); server = null; },
    // código novo: quem tinha o antigo perde o acesso na hora
    rotate() { newToken(); },
    // só o painel local chama isto: é ele que mostra o código pra parear
    info() {
      if (!server) return { on: false, port: d.port, links: [] };
      return { on: true, port: d.port, links: addresses().map((a) => { const url = `http://${a.ip}:${d.port}/#${token}`; return { label: a.label, url, qr: qr(url) }; }) };
    },
  };
}
