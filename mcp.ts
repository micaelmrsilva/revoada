// Ponte MCP: é este processo que cada CLI (Claude, Codex) sobe para falar com a Revoada. Ele não tem
// poder próprio: repassa cada chamada para o servidor, que confere a credencial da conversa e aplica
// as travas. Fala MCP pela entrada e saída padrão (JSON-RPC, uma mensagem por linha).
import { GUIDE } from "./agent-guide";

const str = (description: string) => ({ type: "string", description });
const AGENTE = { type: "string", enum: ["claude", "codex", "gemini", "grok"], description: "Qual agente faz. Sem este campo, o mesmo tipo de agente que você." };
export const TOOLS = [
  { name: "estado", description: "Como está a Revoada agora: contas prontas e no limite, quantas tarefas você ainda pode criar, e as conversas e tarefas que você abriu.", inputSchema: { type: "object", properties: {} } },
  { name: "quadro_listar", description: "As tarefas do quadro deste projeto, com a coluna de cada uma (a fazer, fazendo, revisar, feito).", inputSchema: { type: "object", properties: {} } },
  { name: "quadro_criar_tarefa", description: "Põe uma tarefa no quadro para outro agente fazer numa cópia própria do repositório. O usuário acompanha pelo quadro. Use para trabalho independente do seu; conta no seu limite.", inputSchema: { type: "object", required: ["pedido"], properties: { pedido: str("O pedido completo, para quem não leu esta conversa: arquivos, o que tem que estar verdadeiro no fim, o que não mexer."), titulo: str("Título curto do cartão."), agente: AGENTE, comecar: { type: "boolean", description: "Começar agora (padrão) ou deixar em 'a fazer' para o usuário decidir." } } } },
  { name: "delegar", description: "Abre uma conversa com outro agente para uma parte do trabalho e devolve o id. Leia o resultado com conversa_ler. Conta no seu limite.", inputSchema: { type: "object", required: ["pedido"], properties: { pedido: str("O pedido completo, para quem não leu esta conversa."), agente: AGENTE, isolar: { type: "boolean", description: "Trabalhar numa cópia própria do repositório (padrão quando a pasta é um repositório). Use false só para tarefa que não mexe em arquivo." } } } },
  { name: "conversa_ler", description: "Estado e resposta de uma conversa que você abriu (delegar ou tarefa do quadro). Com esperar_segundos, só responde quando o agente terminar ou o tempo acabar.", inputSchema: { type: "object", required: ["id"], properties: { id: str("Id devolvido por delegar ou quadro_criar_tarefa."), esperar_segundos: { type: "number", description: "Quanto esperar o agente terminar, até 110." } } } },
  { name: "pedir_revisao", description: "Pede que outra conta, de outro provedor, revise o que você mudou nos arquivos. A revisão roda quando a sua resposta terminar e aparece na conversa para o usuário.", inputSchema: { type: "object", properties: {} } },
  { name: "agendar", description: "Agenda um pedido para rodar depois, uma vez ou todo dia. Conta no seu limite.", inputSchema: { type: "object", required: ["pedido"], properties: { pedido: str("O pedido que vai rodar."), quando: str("Data e hora ISO (2026-10-11T09:00) para uma vez."), todo_dia_as: str("HH:MM para todo dia. Use este ou 'quando'."), agente: AGENTE } } },
  { name: "buscar_conversas", description: "Procura um texto no que já foi dito nas conversas deste projeto.", inputSchema: { type: "object", required: ["texto"], properties: { texto: str("O que procurar, 3 caracteres ou mais.") } } },
  { name: "cerebro_buscar", description: "Procura na memória compartilhada entre os agentes (preferências do usuário, decisões, como as coisas funcionam).", inputSchema: { type: "object", required: ["texto"], properties: { texto: str("Assunto ou pergunta.") } } },
];

export async function runMcp() {
  const url = process.env.REVOADA_AGENT_URL || "", token = process.env.REVOADA_AGENT_TOKEN || "";
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  async function call(name: string, args: unknown) {
    let body: any;
    try {
      const r = await fetch(`${url}/agent/${name}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args || {}), signal: AbortSignal.timeout(125_000) });
      body = await r.json().catch(() => ({ ok: false, code: "invalido", message: `a Revoada respondeu ${r.status} sem corpo` }));
    } catch (e: any) { body = { ok: false, code: "revoada_fechada", message: `não consegui falar com a Revoada: ${e?.message || e}` }; }
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: body?.ok === false };
  }
  async function handle(req: any) {
    const reply = (result: unknown) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, result });
    if (req.method === "initialize") return reply({ protocolVersion: req.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "revoada", version: "1" }, instructions: GUIDE });
    if (req.method === "ping") return reply({});
    if (req.method === "tools/list") return reply({ tools: TOOLS });
    if (req.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === req.params?.name);
      if (!tool) return reply({ content: [{ type: "text", text: JSON.stringify({ ok: false, code: "nao_existe", message: `ferramenta ${req.params?.name} não existe` }) }], isError: true });
      return reply(await call(tool.name, req.params?.arguments));
    }
    if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `método ${req.method} não existe` } });
  }
  const dec = new TextDecoder();
  let buf = "";
  const pending: Promise<unknown>[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    buf += dec.decode(chunk, { stream: true });
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
      const line = buf.slice(0, i).trim();
      if (!line) continue;
      try { pending.push(handle(JSON.parse(line)).catch(() => {})); } catch {}
    }
  }
  await Promise.all(pending);
}
