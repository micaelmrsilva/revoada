// Supervisor: você faz um pedido grande a um agente e ele é entregue por vários. Um agente lê o
// projeto e divide o pedido em tarefas independentes; você aprova o plano; cada tarefa roda numa
// cópia isolada do repositório, em contas diferentes; outra conta revisa o que cada uma mexeu; e no
// fim um agente junta os branches. O plano passa por você antes de gastar conta com a execução.
import { readFileSync, writeFileSync } from "fs";

export const MAX_TASKS = 5;
export type Task = { title: string; prompt: string; convo?: string; branch?: string; error?: string; reviewed?: boolean };
export type Mission = {
  id: string; prompt: string; cwd: string; planner: string; workers: string[]; at: number;
  state: "planejando" | "plano" | "rodando" | "pronta" | "erro";
  plan: string; note?: string; tasks: Task[]; merge?: string; error?: string;
};
type ConvoView = { working: boolean; lastState?: string; text: string; error?: string; touchedFiles: boolean; branch?: string } | null;

export const PLAN_PROMPT = (ask: string) => `Você é o supervisor de uma equipe de agentes de código. Divida o pedido abaixo em tarefas que agentes diferentes possam fazer ao mesmo tempo, cada um numa cópia própria deste repositório, sem depender do resultado um do outro e sem mexer nos mesmos arquivos.

Olhe o projeto antes de dividir (você está em modo só leitura). No máximo ${MAX_TASKS} tarefas. Se o pedido for pequeno ou não der para separar sem conflito, devolva uma tarefa só: dividir mal é pior do que não dividir.

Cada tarefa precisa de um título curto e de um pedido completo, que faça sentido para quem não leu este: quais arquivos ou área, o que tem que estar verdadeiro no fim, e o que não mexer.

Responda com um parágrafo curto explicando a divisão e termine com este bloco, nada depois dele:

\`\`\`json
{"tarefas":[{"titulo":"...","pedido":"..."}]}
\`\`\`

<pedido>
${ask}
</pedido>`;

// o plano vem no fim da resposta, num bloco json; aceita também o objeto solto
export function parsePlan(text: string): { note: string; tasks: { title: string; prompt: string }[] } | null {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const loose = text.match(/\{\s*"tarefas"[\s\S]*\}/)?.[0];
  for (const raw of [...blocks.reverse(), loose].filter(Boolean) as string[]) {
    try {
      const j = JSON.parse(raw);
      const tasks = (Array.isArray(j.tarefas) ? j.tarefas : []).map((t: any) => ({ title: String(t.titulo || "").trim().slice(0, 80), prompt: String(t.pedido || "").trim() })).filter((t: any) => t.title && t.prompt).slice(0, MAX_TASKS);
      if (tasks.length) return { note: text.slice(0, text.indexOf("```") >= 0 ? text.indexOf("```") : text.length).trim().slice(0, 1200), tasks };
    } catch {}
  }
  return null;
}

export function createMissions(o: {
  file: string;
  plan: (m: Mission) => string;                          // abre a conversa do planejador e devolve o id
  launch: (m: Mission, t: Task, worker: string) => Promise<{ convo: string; branch?: string }>;
  convo: (id: string) => ConvoView;
  review: (convo: string) => Promise<unknown>;
  merge: (m: Mission, branches: { title: string; branch: string }[]) => Promise<string>;
}) {
  let list: Mission[] = (() => { try { return JSON.parse(readFileSync(o.file, "utf8")); } catch { return []; } })();
  const save = () => writeFileSync(o.file, JSON.stringify(list, null, 2));
  const get = (id: string) => list.find((m) => m.id === id);

  // anda cada missão para o próximo estado conforme as conversas dela terminam
  function advance() {
    let changed = false;
    for (const m of list) {
      if (m.state === "planejando") {
        const c = o.convo(m.plan);
        if (!c) { m.state = "erro"; m.error = "a conversa do plano foi apagada"; changed = true; continue; }
        if (c.working) continue;
        const plan = c.lastState === "done" ? parsePlan(c.text) : null;
        if (plan) { m.tasks = plan.tasks; m.note = plan.note; m.state = "plano"; }
        else { m.state = "erro"; m.error = c.error || "o planejador não devolveu um plano que desse para ler; abra a conversa do plano para ver o que ele disse"; }
        changed = true;
      } else if (m.state === "rodando") {
        let open = 0;
        for (const t of m.tasks) {
          if (t.error) continue;
          const c = t.convo ? o.convo(t.convo) : null;
          if (!c) { if (t.convo) { t.error = "a conversa desta tarefa foi apagada"; changed = true; } else open++; continue; }
          if (c.working) { open++; continue; }
          // tarefa pronta que mexeu em arquivo passa por outra conta antes de contar como entregue
          if (!t.reviewed && c.lastState === "done") {
            t.reviewed = true;
            changed = true;
            if (c.touchedFiles) { o.review(t.convo!).catch(() => {}); open++; }
          }
        }
        if (!open && m.tasks.every((t) => t.error || t.convo)) { m.state = "pronta"; changed = true; }
      }
    }
    if (changed) save();
  }
  const timer = setInterval(advance, 1500);

  return {
    list: () => { advance(); return list; },
    get: (id: string) => { advance(); return get(id); },
    create(input: { prompt: string; cwd: string; planner: string; workers: string[] }) {
      const m: Mission = { id: crypto.randomUUID().slice(0, 8), ...input, at: Date.now(), state: "planejando", plan: "", tasks: [] };
      m.plan = o.plan(m);
      list.unshift(m);
      save();
      return m;
    },
    // o plano aprovado vira execução: uma conversa por tarefa, revezando as contas escolhidas
    async start(id: string) {
      const m = get(id);
      if (!m) throw new Error("missão não existe");
      if (m.state !== "plano") throw new Error("esta missão não está esperando aprovação");
      m.state = "rodando";
      save();
      await Promise.all(m.tasks.map(async (t, i) => {
        try { Object.assign(t, await o.launch(m, t, m.workers[i % m.workers.length])); }
        catch (e: any) { t.error = String(e?.message || e); }
      }));
      save();
      return m;
    },
    async merge(id: string) {
      const m = get(id);
      if (!m) throw new Error("missão não existe");
      const branches = m.tasks.filter((t) => t.branch && !t.error).map((t) => ({ title: t.title, branch: t.branch! }));
      if (!branches.length) throw new Error("nenhuma tarefa deixou branch para juntar");
      m.merge = await o.merge(m, branches);
      save();
      return m;
    },
    remove(id: string) { list = list.filter((m) => m.id !== id); save(); },
    stop() { clearInterval(timer); },
  };
}
