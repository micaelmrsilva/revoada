// Sobe a Revoada inteira numa pasta de usuário descartável, com os CLIs de mentira no PATH.
// Nada toca na sua conta nem na sua pasta. Usado pelo teste de tela e pelo `bun run demo`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

// Uma porta livre de verdade, com a seguinte livre também (é a do acompanhamento pelo celular).
// Sortear dentro de uma faixa já caiu em cima do AirPlay (5000) e do Postgres (5432).
function freePort(): number {
  for (let i = 0; i < 20; i++) {
    const a = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = a.port!;
    let ok = true;
    try { Bun.serve({ port: port + 1, hostname: "127.0.0.1", fetch: () => new Response("") }).stop(true); } catch { ok = false; }
    a.stop(true);
    if (ok) return port;
  }
  throw new Error("não achei duas portas livres seguidas");
}

export async function sobe(port: number = freePort()) {
  const home = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "revoada-demo-"));
  const origin = `http://127.0.0.1:${port}`;
  const repo = join(home, "git", "loja");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=demo", "-c", "user.email=demo@exemplo.dev", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# loja\n");
  git("add", ".");
  git("commit", "-qm", "inicial");

  const server = Bun.spawn(["bun", "server.ts"], {
    cwd: ROOT, stdout: "ignore", stderr: "inherit",
    env: { ...process.env, HOME: home, REVOADA_HOME: join(home, ".revoada"), REVOADA_VAULT: join(home, "cofre"), PORT: String(port), PATH: `${join(ROOT, "tests/stubs")}:${process.env.PATH}`, GEMINI_API_KEY: "", OLLAMA_HOST: "http://127.0.0.1:1", REVOADA_ASSETS: "", REVOADA_PROJECTS: "", REVOADA_REMOTE_PORT: "" },
  });
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch(`${origin}/api/${path}`, { method, headers: { origin, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})) as any;
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  }
  async function until<T>(fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, ms = 15_000): Promise<T> {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = await fn(); if (v) return v; await Bun.sleep(80); }
    throw new Error("esperei demais");
  }
  await until(() => fetch(`${origin}/api/dirs`).then((r) => r.ok).catch(() => false));
  await api("state?refresh=1");
  await api("settings", "POST", { onboarded: true });
  const chat = async (target: string, prompt: string, extra: Record<string, unknown> = {}) => (await api("chat", "POST", { prompt, targets: [target], cwd: home, brain: false, mode: "edit", ...extra })).id as string;
  const idle = (id: string) => until(async () => { const c = await api(`convos/${id}`); return !c.working && c; });
  return { home, repo, origin, api, until, chat, idle, async stop() { server.kill(); await server.exited; rmSync(home, { recursive: true, force: true }); } };
}
