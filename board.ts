// Quadro de tarefas: em vez de uma conversa de cada vez, você despeja as tarefas e cada cartão vira
// um agente trabalhando numa cópia própria do repositório. O cartão anda sozinho: "fazendo" enquanto
// o agente trabalha, "revisar" quando ele termina (se mexeu em arquivo, outra conta revisa antes),
// e só vai para "feito" pela sua mão.
import { readFileSync, writeFileSync } from "fs";

export type Column = "todo" | "doing" | "review" | "done";
export type Card = { id: string; title: string; prompt: string; cwd: string; target: string; at: number; state: Column; convo?: string; note?: string; reviewed?: boolean };
type ConvoView = { working: boolean; waiting: boolean; lastState?: string; touchedFiles: boolean } | null;
const COLUMNS: Column[] = ["todo", "doing", "review", "done"];

export function createBoard(o: {
  file: string;
  launch: (c: Card) => Promise<string>;      // abre a conversa da tarefa e devolve o id
  convo: (id: string) => ConvoView;
  review: (convo: string) => Promise<unknown>;
}) {
  let cards: Card[] = (() => { try { return JSON.parse(readFileSync(o.file, "utf8")); } catch { return []; } })();
  const save = () => writeFileSync(o.file, JSON.stringify(cards, null, 2));
  const get = (id: string) => { const c = cards.find((x) => x.id === id); if (!c) throw new Error("cartão não existe"); return c; };

  // anda cada cartão conforme a conversa dele termina
  function advance() {
    let changed = false;
    for (const c of cards) {
      if (c.state !== "doing" && c.state !== "review") continue;
      if (starting.has(c.id)) continue; // a conversa ainda está sendo aberta (criar a cópia do repositório leva um instante)
      const v = c.convo ? o.convo(c.convo) : null;
      if (!v) { c.state = "todo"; c.note = "a conversa desta tarefa foi apagada"; delete c.convo; delete c.reviewed; changed = true; continue; }
      if (v.working) continue;
      if (c.state === "doing") { c.state = "review"; c.note = v.lastState === "error" ? "terminou com erro" : v.lastState === "stopped" ? "foi interrompida" : undefined; changed = true; }
      // tarefa que mexeu em arquivo passa por outra conta antes de você olhar
      if (!c.reviewed && v.lastState === "done") {
        c.reviewed = true;
        changed = true;
        // entre pedir a revisão e ela começar há um instante em que a conversa parece parada: o cartão conta como ocupado
        if (v.touchedFiles) { reviewing.add(c.id); o.review(c.convo!).catch(() => {}).finally(() => reviewing.delete(c.id)); }
      }
    }
    if (changed) save();
  }
  const starting = new Set<string>(), reviewing = new Set<string>();
  const timer = setInterval(advance, 1500);

  async function start(id: string) {
    const c = get(id);
    if (c.state !== "todo") throw new Error("este cartão já foi começado");
    c.state = "doing"; delete c.note;
    starting.add(c.id);
    try { c.convo = await o.launch(c); }
    catch (e: any) { c.state = "todo"; c.note = String(e?.message || e); save(); throw e; }
    finally { starting.delete(c.id); }
    save();
    return c;
  }

  return {
    // cada cartão sai com o que a conversa dele está fazendo agora
    list() {
      advance();
      return cards.map((c) => { const v = c.convo ? o.convo(c.convo) : null; return { ...c, working: !!v?.working || reviewing.has(c.id) || starting.has(c.id), waiting: !!v?.waiting }; });
    },
    add(input: { prompt: string; cwd: string; target: string; title?: string }) {
      const c: Card = { id: crypto.randomUUID().slice(0, 8), title: (input.title || input.prompt.split("\n")[0]).trim().slice(0, 80), prompt: input.prompt, cwd: input.cwd, target: input.target, at: Date.now(), state: "todo" };
      cards.push(c);
      save();
      return c;
    },
    start,
    // arrastar: para "fazendo" começa; para "feito" encerra; de volta para "a fazer" solta a conversa
    async move(id: string, to: string) {
      const c = get(id);
      if (!COLUMNS.includes(to as Column)) throw new Error("coluna não existe");
      if (to === c.state) return c;
      if (to === "doing") return start(id);
      const v = c.convo ? o.convo(c.convo) : null;
      if (v?.working || reviewing.has(id) || starting.has(id)) throw new Error("o agente desta tarefa ainda está trabalhando; pare a conversa antes de mover o cartão");
      if (to === "review") throw new Error("o cartão vai para revisar sozinho, quando o agente termina");
      if (to === "done" && c.state === "todo") throw new Error("esta tarefa ainda não foi feita");
      if (to === "todo") { delete c.convo; delete c.reviewed; delete c.note; }
      c.state = to as Column;
      save();
      return c;
    },
    remove(id: string) { cards = cards.filter((c) => c.id !== id); save(); },
    stop() { clearInterval(timer); },
  };
}
