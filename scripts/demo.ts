// bun run demo: o painel com conversas de exemplo, pra mexer na interface sem gastar conta nem
// tocar na sua pasta. Os agentes são os de mentira dos testes (tests/stubs). Ctrl+C encerra e apaga.
import { sobe } from "../tests/ambiente";

const env = await sobe(Number(process.env.DEMO_PORT || 4790));
const reserva = (await env.api("accounts", "POST", { provider: "codex", label: "reserva" })).id;
await env.api("state?refresh=1");
// uma resposta longa e formatada, uma parada pedindo permissão, e uma revisada por outra conta
await env.idle(await env.chat("claude-padrao", "DEMO-RICA: e já foi?"));
await env.chat("claude-padrao", "DEMO-RICA: retoma a criação da rodada", { mode: "ask" });
const rev = await env.chat(reserva, "CRIA-ARQUIVO de exportação de pedidos", { cwd: env.repo, isolate: true });
await env.idle(rev);
await env.api(`convos/${rev}/review`, "POST", {});

console.log(`\nRevoada de demonstração em ${env.origin}\n(pasta descartável: ${env.home})\nCtrl+C para encerrar.\n`);
if (process.platform === "darwin" && !process.env.DEMO_QUIET) Bun.spawn(["open", env.origin]);
const bye = async () => { await env.stop(); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
await new Promise(() => {});
