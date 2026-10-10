// Skills e servidores MCP em todas as contas. Cada conta isolada tem a própria pasta de configuração,
// então o que você instala na conta padrão da máquina não aparece nas outras. Aqui a conta padrão de
// cada provedor é a fonte:
//  - skills entram nas outras contas como atalhos (symlinks) para a pasta original. Pasta de verdade
//    que a conta já tenha nunca é tocada, e só os atalhos são removidos quando a skill some da fonte.
//  - servidores MCP não são copiados para dentro do perfil (o CLI regrava esse arquivo o tempo todo):
//    vão como argumento em cada execução que a Revoada inicia.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";

type Acc = { id: string; provider: string; home: string | null };

export function createTools(o: { home: string; root: string }) {
  // pasta de skills de uma conta; home null = a conta padrão da máquina
  const skillsDir = (provider: string, home: string | null) =>
    provider === "claude" ? join(home || join(o.home, ".claude"), "skills")
    : provider === "codex" ? join(home || join(o.home, ".codex"), "skills")
    : provider === "gemini" ? join(home || o.home, ".gemini", "skills")
    : join(home || join(o.home, ".grok"), "skills");

  const entries = (dir: string) => { try { return readdirSync(dir).filter((n) => !n.startsWith(".")); } catch { return []; } };
  const real = (p: string) => { try { return realpathSync(p); } catch { return null; } };
  const isLink = (p: string) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

  // os atalhos que a Revoada criou, por conta: é o que permite remover só o que é dela
  const linksFile = join(o.root, "skills-links.json");
  const links: Record<string, Record<string, string>> = (() => { try { return JSON.parse(readFileSync(linksFile, "utf8")); } catch { return {}; } })();
  const saveLinks = () => writeFileSync(linksFile, JSON.stringify(links));
  const mine = (acc: Acc, name: string, p: string) => { try { return isLink(p) && links[acc.id]?.[name] === readlinkSync(p); } catch { return false; } };

  function syncSkills(acc: Acc) {
    const out = { linked: 0, own: 0, removed: 0, total: 0 };
    if (!acc.home) return out;
    const src = skillsDir(acc.provider, null), dest = skillsDir(acc.provider, acc.home);
    const source = new Map<string, string>();
    for (const name of entries(src)) { const r = real(join(src, name)); if (r && existsSync(join(r, "SKILL.md"))) source.set(name, r); }
    out.total = source.size;
    if (!source.size && !existsSync(dest)) return out;
    mkdirSync(dest, { recursive: true });
    const made = (links[acc.id] ||= {});
    for (const name of entries(dest)) {
      const p = join(dest, name);
      if (!mine(acc, name, p)) { out.own++; continue; } // pasta de verdade, ou atalho que a pessoa mesma fez
      if (source.get(name) === made[name]) continue;
      rmSync(p, { force: true }); // saiu da fonte ou mudou de lugar
      delete made[name];
      out.removed++;
    }
    for (const [name, target] of source) {
      const p = join(dest, name);
      if (existsSync(p) || isLink(p)) continue;
      symlinkSync(target, p);
      made[name] = target;
      out.linked++;
    }
    saveLinks();
    return out;
  }
  function unlinkSkills(acc: Acc) {
    if (!acc.home) return 0;
    const dest = skillsDir(acc.provider, acc.home);
    let n = 0;
    for (const name of entries(dest)) { const p = join(dest, name); if (mine(acc, name, p)) { rmSync(p, { force: true }); n++; } }
    delete links[acc.id];
    saveLinks();
    return n;
  }

  // ---------- MCP ----------
  function claudeServers(): Record<string, unknown> {
    try { return JSON.parse(readFileSync(join(o.home, ".claude.json"), "utf8")).mcpServers || {}; } catch { return {}; }
  }
  function codexServers(): Record<string, unknown> {
    try { return (Bun.TOML.parse(readFileSync(join(o.home, ".codex", "config.toml"), "utf8")) as any).mcp_servers || {}; } catch { return {}; }
  }
  // valor em TOML de uma linha, do jeito que o `codex -c chave=valor` espera
  const toml = (v: unknown): string =>
    typeof v === "string" ? JSON.stringify(v)
    : typeof v === "number" || typeof v === "boolean" ? String(v)
    : Array.isArray(v) ? `[${v.map(toml).join(", ")}]`
    : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)} = ${toml(x)}`).join(", ")} }`
    : '""';

  const mcpFile = join(o.root, "mcp-claude.json");
  // argumentos a mais para uma execução desta conta; vazio para a conta padrão, que já tem tudo
  function mcpArgs(acc: Acc): string[] {
    if (!acc.home) return [];
    if (acc.provider === "claude") {
      const servers = claudeServers();
      if (!Object.keys(servers).length) return [];
      // o arquivo leva as mesmas chaves que já estão no ~/.claude.json: fica só para o dono ler
      const body = JSON.stringify({ mcpServers: servers });
      let cur = ""; try { cur = readFileSync(mcpFile, "utf8"); } catch {}
      if (cur !== body) { writeFileSync(mcpFile, body, { mode: 0o600 }); chmodSync(mcpFile, 0o600); }
      return ["--mcp-config", mcpFile];
    }
    if (acc.provider === "codex") return Object.entries(codexServers()).filter(([name]) => /^[\w-]+$/.test(name)).flatMap(([name, def]) => ["-c", `mcp_servers.${name}=${toml(def)}`]);
    return [];
  }

  return {
    syncSkills, unlinkSkills, mcpArgs, skillsDir,
    // o que existe na fonte, pra tela mostrar
    summary(accounts: Acc[]) {
      const count = (provider: string) => entries(skillsDir(provider, null)).filter((n) => existsSync(join(skillsDir(provider, null), n, "SKILL.md"))).length;
      const providers = [...new Set(accounts.map((a) => a.provider))];
      return {
        skills: Object.fromEntries(providers.map((p) => [p, count(p)])),
        mcp: { claude: Object.keys(claudeServers()), codex: Object.keys(codexServers()) },
        accounts: accounts.filter((a) => a.home).map((a) => {
          const dest = skillsDir(a.provider, a.home);
          const names = entries(dest);
          const linked = names.filter((n) => mine(a, n, join(dest, n))).length;
          return { id: a.id, linked, own: names.length - linked };
        }),
      };
    },
  };
}
