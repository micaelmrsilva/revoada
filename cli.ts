#!/usr/bin/env bun
// revoada: a linha de comando do painel. Fala com a Revoada que está aberta nesta máquina, pra você
// (ou um script, ou um agente de fora) fazer pelo terminal o que faria pela tela.
// Saída: texto para gente por padrão, `--json` para máquina. Falha sai com `erro [código]: frase`
// no erro padrão e código de saída diferente de zero; o código entre colchetes é estável.
const PORT = Number(process.env.REVOADA_PORT || process.env.PORT || 4777);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const flags: Record<string, string | true> = {}, words: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) { const k = a.slice(2), next = argv[i + 1]; if (["json", "esperar", "isolar", "comecar", "plano", "ajuda"].includes(k) || next === undefined || next.startsWith("--")) flags[k] = true; else { flags[k] = next; i++; } }
  else words.push(a);
}
const [cmd, ...rest] = words;
const JSON_OUT = !!flags.json;

class Fail extends Error { constructor(public code: string, message: string, public exit = 1) { super(message); } }
function die(e: any): never {
  const code = e instanceof Fail ? e.code : "invalido", message = String(e?.message || e);
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, code, message }));
  else console.error(`erro [${code}]: ${message}`);
  process.exit(e instanceof Fail ? e.exit : 1);
}
async function api(path: string, method = "GET", body?: unknown) {
  let r: Response;
  try { r = await fetch(`${ORIGIN}/api/${path}`, { method, headers: { origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Fail("revoada_fechada", `a Revoada não está aberta nesta máquina (porta ${PORT}). Abra o app, ou rode \`bun start\` na pasta dela.`, 4); }
  const j = await r.json().catch(() => ({})) as any;
  if (!r.ok) throw new Fail(j.code || "invalido", j.error || `a Revoada respondeu ${r.status}`);
  return j;
}
const out = (human: string, data: unknown) => console.log(JSON_OUT ? JSON.stringify({ ok: true, ...(data as object) }) : human);
const MODES: Record<string, string> = { ler: "read", perguntar: "ask", editar: "edit", total: "full", read: "read", ask: "ask", edit: "edit", full: "full" };
const stateOf = (c: any) => { const last = c.messages.findLast((m: any) => m.role === "assistant"); return c.waiting ? "esperando_permissao" : c.working ? "trabalhando" : last?.state === "done" ? "pronta" : last?.state === "error" ? "erro" : last?.state === "stopped" ? "interrompida" : "trabalhando"; };
const answer = (c: any) => (c.messages.findLast((m: any) => m.role === "assistant" && !m.review)?.items || []).filter((i: any) => i.kind === "text").map((i: any) => i.text).join("\n");

// alvo: tipo de agente (rodízio entre as contas dele) ou o nome/id de uma conta
async function targetOf(name: string | true | undefined) {
  const s = await api("state");
  if (!name || name === true) { const p = s.providers.find((x: any) => x.installed && s.accounts.some((a: any) => a.provider === x.id && a.status.ok && !a.limit)); if (!p) throw new Fail("sem_conta_pronta", "nenhuma conta pronta. Faça login em Contas."); return `pool:${p.id}`; }
  if (s.providers.some((p: any) => p.id === name)) return `pool:${name}`;
  const acc = s.accounts.find((a: any) => a.id === name || a.label === name);
  if (!acc) throw new Fail("nao_existe", `não há agente nem conta chamada "${name}". Agentes: ${s.providers.map((p: any) => p.id).join(", ")}.`);
  return acc.id as string;
}
// acompanha uma conversa até o agente parar (pronto, erro ou esperando você)
async function follow(id: string) {
  for (;;) {
    const c = await api(`convos/${id}`), st = stateOf(c);
    if (st !== "trabalhando") return { c, st };
    await Bun.sleep(700);
  }
}
function report(c: any, st: string) {
  const exit = st === "pronta" ? 0 : st === "esperando_permissao" ? 3 : 2;
  const last = c.messages.findLast((m: any) => m.role === "assistant");
  const ask = (last?.items || []).find((i: any) => i.kind === "ask" && i.state === "pending");
  out(st === "pronta" ? answer(c) : st === "esperando_permissao" ? `${answer(c)}\n[esperando permissão: ${ask?.tool} ${ask?.detail}. Abra a conversa ${c.id} na Revoada para permitir ou negar]`.trim() : `${answer(c)}\n[${st}: ${last?.error || ""}]`.trim(),
    { id: c.id, estado: st, resposta: answer(c), erro: last?.error, permissao: ask ? { ferramenta: ask.tool, detalhe: ask.detail } : undefined });
  process.exit(exit);
}

const HELP = `revoada: a linha de comando do painel

  revoada estado                          contas, conversas em andamento e o quadro
  revoada pedir "<pedido>"                abre uma conversa com um agente
      --agente claude|codex|gemini|grok|<conta>   quem responde (padrão: o primeiro pronto)
      --pasta <caminho>                   onde ele trabalha (padrão: a pasta atual)
      --modo ler|perguntar|editar|total   o que ele pode fazer (padrão: editar)
      --modelo <nome|auto>  --esforco low|medium|high|xhigh|max
      --isolar                            numa cópia própria do repositório
      --plano                             tarefa longa, com plano em arquivo
      --esperar                           só volta quando o agente terminar, com a resposta
  revoada conversa <id> [--esperar]       estado e resposta de uma conversa
  revoada responder <id> "<texto>"        manda outra mensagem na conversa
  revoada tarefa "<texto>" [--comecar]    põe uma tarefa no quadro (uma por linha vira várias)
  revoada quadro                          as tarefas do quadro
  revoada buscar "<texto>"                procura no conteúdo das conversas
  revoada guia                            o guia de uso para agentes

Toda saída aceita --json. Códigos de saída: 0 certo, 1 erro de uso, 2 o agente terminou com erro,
3 o agente está esperando a sua permissão, 4 a Revoada não está aberta.`;

try {
  if (!cmd || flags.ajuda || cmd === "ajuda" || cmd === "help") { console.log(HELP); process.exit(0); }
  if (cmd === "estado") {
    const s = await api("state");
    const accs = s.accounts.filter((a: any) => a.status.ok).map((a: any) => ({ agente: a.provider, nome: a.label, no_limite: !!a.limit, uso: (a.usage || []).map((u: any) => `${u.key} ${u.pct}%`) }));
    const live = s.convos.filter((c: any) => c.working).map((c: any) => ({ id: c.id, titulo: c.title, estado: c.waiting ? "esperando_permissao" : "trabalhando" }));
    out([`Contas prontas: ${accs.map((a: any) => `${a.agente}/${a.nome}${a.no_limite ? " (no limite)" : ""}`).join(", ") || "nenhuma"}`,
      live.length ? `Em andamento:\n${live.map((c: any) => `  ${c.id}  ${c.estado}  ${c.titulo}`).join("\n")}` : "Nenhum agente trabalhando.", `Quadro: ${s.board} tarefa(s) em aberto. Agendados: ${s.schedules}.`].join("\n"), { contas: accs, em_andamento: live, quadro_abertas: s.board, agendados: s.schedules });
  } else if (cmd === "pedir") {
    const prompt = rest.join(" ").trim();
    if (!prompt) throw new Fail("pedido_vazio", 'faltou o pedido: revoada pedir "o que fazer"');
    const mode = MODES[String(flags.modo || "editar")];
    if (!mode) throw new Fail("invalido", "--modo aceita ler, perguntar, editar ou total");
    const r = await api("chat", "POST", { prompt, targets: [await targetOf(flags.agente)], cwd: typeof flags.pasta === "string" ? flags.pasta : process.cwd(), brain: true, mode, isolate: !!flags.isolar, plan: !!flags.plano, model: typeof flags.modelo === "string" ? flags.modelo : null, effort: typeof flags.esforco === "string" ? flags.esforco : null });
    if (!flags.esperar) out(`conversa ${r.id} aberta. Acompanhe com: revoada conversa ${r.id} --esperar`, { id: r.id, estado: "trabalhando" });
    else { const { c, st } = await follow(r.id); report(c, st); }
  } else if (cmd === "conversa") {
    if (!rest[0]) throw new Fail("invalido", "faltou o id: revoada conversa <id>");
    const { c, st } = flags.esperar ? await follow(rest[0]) : await api(`convos/${rest[0]}`).then((c) => ({ c, st: stateOf(c) }));
    report(c, st);
  } else if (cmd === "responder") {
    const [id, ...text] = rest;
    if (!id || !text.join(" ").trim()) throw new Fail("invalido", 'uso: revoada responder <id> "<texto>"');
    const r = await api(`convos/${id}/send`, "POST", { text: text.join(" ") });
    if (!flags.esperar) out(r.queued ? "na fila: entra quando o agente terminar" : "enviada", { id, na_fila: !!r.queued });
    else { await Bun.sleep(300); const { c, st } = await follow(id); report(c, st); }
  } else if (cmd === "tarefa") {
    const prompt = rest.join(" ").trim();
    if (!prompt) throw new Fail("pedido_vazio", 'faltou a tarefa: revoada tarefa "o que fazer"');
    const cards = await api("board", "POST", { prompt, cwd: typeof flags.pasta === "string" ? flags.pasta : process.cwd(), target: await targetOf(flags.agente), split: prompt.includes("\n") });
    if (flags.comecar) for (const c of cards) await api(`board/${c.id}/start`, "POST", {});
    out(cards.map((c: any) => `${c.id}  ${flags.comecar ? "fazendo" : "a fazer"}  ${c.title}`).join("\n"), { tarefas: cards.map((c: any) => ({ id: c.id, titulo: c.title, coluna: flags.comecar ? "doing" : "todo" })) });
  } else if (cmd === "quadro") {
    const cards = await api("board"), name: Record<string, string> = { todo: "a fazer", doing: "fazendo", review: "revisar", done: "feito" };
    out(cards.length ? cards.map((c: any) => `${c.id}  ${name[c.state].padEnd(8)}  ${c.title}${c.working ? "  (trabalhando)" : ""}`).join("\n") : "O quadro está vazio.", { tarefas: cards.map((c: any) => ({ id: c.id, titulo: c.title, coluna: c.state, trabalhando: c.working, conversa: c.convo })) });
  } else if (cmd === "buscar") {
    const q = rest.join(" ").trim();
    if (q.length < 3) throw new Fail("invalido", "a busca precisa de 3 caracteres ou mais");
    const r = await api(`search?q=${encodeURIComponent(q)}`), all = [...r.chats.map((h: any) => ({ id: h.id, titulo: h.title, trecho: h.snippet })), ...r.history.map((h: any) => ({ arquivo: h.file, titulo: h.title, trecho: h.snippet }))];
    out(all.length ? all.map((h: any) => `${h.id || "(outro programa)"}  ${h.titulo}\n    ${h.trecho}`).join("\n") : "Nada encontrado.", { resultados: all });
  } else if (cmd === "guia") {
    const g = await api("guide");
    out(g.guide, { guia: g.guide, limite: g.limite });
  } else throw new Fail("invalido", `comando "${cmd}" não existe. Rode: revoada ajuda`);
} catch (e) { die(e); }
