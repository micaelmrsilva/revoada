// Cópias de repositório que os agentes deixam pra trás (clones lado a lado e worktrees).
// Acha, mede, diz o que é seguro apagar e manda pra Lixeira. Nunca apaga de vez e nunca
// toca na cópia principal nem em pasta com sessão aberta.
import { existsSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";

const SCAN_DEPTH = 4;
const IDLE_BEFORE_AUTO_MS = 60 * 60_000; // cópia mexida há menos de 1h não sai sozinha
const PR_CACHE_MS = 10 * 60_000;
const SKIP = new Set(["node_modules", "dist", "build", "vendor", "target"]);

export type Copy = {
  path: string; name: string; repo: string; kind: "clone" | "worktree"; main: string; branch: string;
  dirty: number; unpushed: number; stash: number; pr: { number: number; state: string; url: string } | null;
  sizeKb: number; touchedAt: number; inUse: boolean; safe: boolean; auto: boolean; why: string[];
  managed: boolean; // criada pela Revoada pra uma tarefa: sai sozinha quando não sobra nada só nela
};

async function sh(cmd: string[], cwd: string, timeoutMs = 15_000) {
  try {
    const p = Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GH_PROMPT_DISABLED: "1" } });
    const t = setTimeout(() => p.kill(), timeoutMs);
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    clearTimeout(t);
    return code === 0 ? out.trim() : "";
  } catch { return ""; }
}
const lines = (s: string) => (s ? s.split("\n").filter(Boolean).length : 0);
const repoId = (url: string) => url.replace(/\.git$/, "").replace(/^(git@|https?:\/\/)/, "").replace(":", "/").toLowerCase();

const IDLE_BEFORE_MANAGED_MS = 20 * 60_000;

export function createClones(opts: { home: string; roots: string[]; extra: string[]; managedRoot: string; inUse: (path: string) => boolean }) {
  let last: Copy[] = [];
  let scannedAt = 0;
  let running: Promise<Copy[]> | null = null;
  const prCache = new Map<string, { at: number; pr: Copy["pr"] }>();

  // checkouts com .git de verdade (pasta); worktree ligado tem .git como arquivo e entra pelo dono
  function findRepos(dir: string, depth: number, out: string[]) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === ".git" && e.isDirectory())) { out.push(dir); return; }
    if (depth >= SCAN_DEPTH) return;
    for (const e of entries) {
      // pastas ocultas entram: é onde agente costuma esconder clone (.claude-tmp, .worktrees)
      if (e.isDirectory() && !SKIP.has(e.name) && e.name !== ".git" && e.name !== ".Trash") findRepos(join(dir, e.name), depth + 1, out);
    }
  }

  async function prFor(dir: string, repo: string, branch: string): Promise<Copy["pr"]> {
    if (!branch || branch === "HEAD") return null;
    const key = `${repo}#${branch}`;
    const hit = prCache.get(key);
    if (hit && Date.now() - hit.at < PR_CACHE_MS) return hit.pr;
    let pr: Copy["pr"] = null;
    try {
      const j = JSON.parse((await sh(["gh", "pr", "list", "--head", branch, "--state", "all", "--json", "number,state,url", "--limit", "1"], dir, 12_000)) || "[]");
      if (j[0]) pr = { number: j[0].number, state: j[0].state, url: j[0].url };
    } catch {}
    prCache.set(key, { at: Date.now(), pr });
    return pr;
  }

  async function inspect(path: string, kind: Copy["kind"], main: string, repo: string): Promise<Copy> {
    const [branch, status, unpushedLog, stashList, du] = await Promise.all([
      sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], path),
      sh(["git", "status", "--porcelain"], path),
      // commit que não está em nenhum remoto: no clone vale pra todo branch local, no worktree só o dele
      sh(["git", "log", kind === "clone" ? "--branches" : "HEAD", "--not", "--remotes", "--oneline"], path),
      kind === "clone" ? sh(["git", "stash", "list"], path) : Promise.resolve(""),
      sh(["du", "-sk", path], path, 60_000),
    ]);
    const dirty = lines(status), unpushed = lines(unpushedLog), stash = lines(stashList);
    const defaultBranch = ["main", "master", "develop"].includes(branch);
    const pr = defaultBranch ? null : await prFor(path, repo, branch);
    let touchedAt = 0;
    for (const f of [path, join(path, ".git", "index"), join(path, ".git")]) { try { touchedAt = Math.max(touchedAt, statSync(f).mtimeMs); } catch {} }
    const inUse = opts.inUse(path);
    const safe = dirty === 0 && unpushed === 0 && stash === 0;
    const why: string[] = [];
    if (dirty) why.push(`${dirty} ${dirty === 1 ? "arquivo alterado" : "arquivos alterados"} sem commit`);
    if (unpushed) why.push(`${unpushed} ${unpushed === 1 ? "commit" : "commits"} sem push`);
    if (stash) why.push(`${stash} stash`);
    if (safe) why.push("tudo que há aqui já está no remoto");
    if (pr) why.push(`PR #${pr.number} ${({ MERGED: "mesclado", OPEN: "aberto", CLOSED: "fechado" } as any)[pr.state] || pr.state}`);
    if (inUse) why.push("tem sessão aberta nesta pasta");
    // sai sozinha só quando o trabalho virou PR, nada ficou só aqui e ninguém mexe há um tempo
    const managed = path.startsWith(opts.managedRoot + "/");
    if (managed) why.unshift("cópia criada pela Revoada");
    const auto = managed ? safe && !inUse && Date.now() - touchedAt > IDLE_BEFORE_MANAGED_MS : safe && !inUse && !!pr && Date.now() - touchedAt > IDLE_BEFORE_AUTO_MS;
    return { managed, path, name: basename(path), repo, kind, main, branch, dirty, unpushed, stash, pr, sizeKb: Number(du.split(/\s/)[0]) || 0, touchedAt, inUse, safe, auto, why };
  }

  async function doScan(): Promise<Copy[]> {
    const repos: string[] = [];
    for (const r of opts.roots) findRepos(r, 0, repos);
    for (const r of opts.extra) if (existsSync(r)) findRepos(r, SCAN_DEPTH - 2, repos);
    const byOrigin = new Map<string, string[]>();
    await Promise.all(repos.map(async (r) => {
      const url = await sh(["git", "config", "--get", "remote.origin.url"], r);
      if (!url) return;
      const id = repoId(url);
      byOrigin.set(id, [...(byOrigin.get(id) || []), r]);
    }));
    const jobs: Promise<Copy>[] = [];
    for (const [repo, dirs] of byOrigin) {
      const name = repo.split("/").pop()!;
      // principal: a pasta com o nome do repositório mais perto da raiz; sem isso, o caminho mais curto
      const shortest = (list: string[]) => [...list].sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0];
      const named = dirs.filter((d) => basename(d).toLowerCase() === name);
      const main = shortest(named.length ? named : dirs);
      for (const d of dirs) if (d !== main) jobs.push(inspect(d, "clone", main, repo));
      for (const d of dirs) {
        const wt = (await sh(["git", "worktree", "list", "--porcelain"], d)).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
        for (const w of wt.slice(1)) if (existsSync(w)) jobs.push(inspect(w, "worktree", d, repo));
      }
    }
    last = (await Promise.all(jobs)).sort((a, b) => b.sizeKb - a.sizeKb);
    scannedAt = Date.now();
    return last;
  }

  function scan(force = false) {
    if (running) return running;
    if (!force && scannedAt && Date.now() - scannedAt < 60_000) return Promise.resolve(last);
    running = doScan().finally(() => (running = null));
    return running;
  }

  async function remove(path: string) {
    // só o que a varredura listou: nunca um caminho qualquer, nunca a cópia principal
    const c = last.find((x) => x.path === path);
    if (!c) throw new Error("cópia não encontrada; atualize a lista");
    if (opts.inUse(path)) throw new Error("tem sessão aberta nesta pasta");
    if (c.managed && c.safe) {
      // nada aqui é único: remove de vez (o próprio git recusa se houver algo sem commit) e solta o branch local
      await sh(["git", "worktree", "remove", path], c.main);
      if (existsSync(path)) throw new Error("o git recusou remover a cópia; confira se há arquivo pendente");
      await sh(["git", "branch", "-d", c.branch], c.main);
      last = last.filter((x) => x.path !== path);
      return { freedKb: c.sizeKb };
    }
    // Lixeira pela API do sistema (NSFileManager): funciona sem permissão especial e o Finder sabe restaurar
    const script = `ObjC.import("Foundation"); function run(argv) { const err = $(); const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), null, err); return ok ? "ok" : "erro: " + err.localizedDescription.js; }`;
    const out = await sh(["osascript", "-l", "JavaScript", "-e", script, path], opts.home, 60_000);
    if (out !== "ok" || existsSync(path)) throw new Error(`não consegui mandar pra Lixeira${out ? ` (${out})` : ""}`);
    if (c.kind === "worktree") await sh(["git", "worktree", "prune"], c.main);
    last = last.filter((x) => x.path !== path);
    return { freedKb: c.sizeKb };
  }

  // as cópias da Revoada saem sempre; as outras só com a limpeza automática ligada
  async function autoClean(includeOthers: boolean) {
    const done: Copy[] = [];
    for (const c of await scan(true)) {
      if (!c.auto || (!c.managed && !includeOthers)) continue;
      try { await remove(c.path); done.push(c); } catch {}
    }
    return done;
  }

  return {
    scan, remove, autoClean,
    summary: () => ({ scannedAt, count: last.length, sizeKb: last.reduce((n, c) => n + c.sizeKb, 0), safe: last.filter((c) => c.safe && !c.inUse).length }),
  };
}
