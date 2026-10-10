// Pedidos agendados: "roda isso às 3h", "toda segunda às 9h". Cada agendamento vira uma conversa
// nova na hora marcada. O relógio só anda com a Revoada aberta e o Mac acordado: ela não acorda a
// máquina. Hora perdida por pouco (Mac dormindo, app fechado) roda ao voltar; perdida por muito, pula.
import { readFileSync, writeFileSync } from "fs";

const GRACE_MS = 6 * 3_600_000; // até quanto depois da hora ainda vale rodar
const TICK_MS = 20_000;

export type Sched = {
  id: string; prompt: string; target: string; cwd: string; mode: string; brain: boolean; isolate: boolean;
  kind: "once" | "daily"; at?: number;         // once: o instante
  time?: string; days?: number[];              // daily: "HH:MM" e dias da semana (0 = domingo); vazio = todo dia
  enabled: boolean; next: number | null; created: number;
  last?: { at: number; convo?: string; error?: string; missed?: boolean };
};
export type SchedInput = Pick<Sched, "prompt" | "target" | "cwd" | "mode" | "brain" | "isolate" | "kind" | "at" | "time" | "days">;

// próxima hora de um agendamento, contada a partir de `from`
export function nextRun(s: Pick<Sched, "kind" | "at" | "time" | "days">, from: number): number | null {
  if (s.kind === "once") return s.at && s.at > from ? s.at : null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.time || "");
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const days = s.days?.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  const d = new Date(from);
  d.setHours(+m[1], +m[2], 0, 0);
  for (let i = 0; i < 8; i++) {
    if (d.getTime() > from && days.includes(d.getDay())) return d.getTime();
    d.setDate(d.getDate() + 1);
    d.setHours(+m[1], +m[2], 0, 0); // a troca de horário de verão pode ter mexido na hora
  }
  return null;
}

export function createSchedules(o: { file: string; run: (s: Sched) => Promise<string>; now?: () => number }) {
  const now = o.now || Date.now;
  let list: Sched[] = (() => { try { return JSON.parse(readFileSync(o.file, "utf8")); } catch { return []; } })();
  const save = () => writeFileSync(o.file, JSON.stringify(list, null, 2));
  const running = new Set<string>();

  async function fire(s: Sched) {
    if (running.has(s.id)) return;
    running.add(s.id);
    const at = now();
    try { s.last = { at, convo: await o.run(s) }; }
    catch (e: any) { s.last = { at, error: String(e?.message || e) }; }
    running.delete(s.id);
    save();
  }

  function tick() {
    const t = now();
    for (const s of list) {
      if (!s.enabled || !s.next || s.next > t) continue;
      const late = t - s.next;
      // avança antes de rodar: se o pedido demorar, o próximo tique não dispara de novo
      const due = s.next;
      s.next = s.kind === "daily" ? nextRun(s, t) : null;
      if (s.kind === "once") s.enabled = false;
      if (late > GRACE_MS) { s.last = { at: due, missed: true }; save(); continue; }
      save();
      fire(s);
    }
  }
  const timer = setInterval(tick, TICK_MS);
  tick();

  return {
    list: () => list,
    add(input: SchedInput) {
      const base = { ...input, days: input.days?.filter((d) => d >= 0 && d <= 6) };
      const next = nextRun(base, now() - 1);
      if (!next) throw new Error(input.kind === "once" ? "essa hora já passou" : "hora inválida: use HH:MM");
      const s: Sched = { ...base, id: crypto.randomUUID().slice(0, 8), enabled: true, next, created: now() };
      list.unshift(s);
      save();
      return s;
    },
    toggle(id: string, enabled: boolean) {
      const s = list.find((x) => x.id === id);
      if (!s) throw new Error("agendamento não existe");
      s.enabled = enabled;
      s.next = enabled ? nextRun(s, now()) : null;
      if (enabled && !s.next) { s.enabled = false; save(); throw new Error("essa hora já passou; crie um novo agendamento"); }
      save();
      return s;
    },
    remove(id: string) { list = list.filter((x) => x.id !== id); save(); },
    async runNow(id: string) { const s = list.find((x) => x.id === id); if (!s) throw new Error("agendamento não existe"); await fire(s); return s; },
    tick,
    stop() { clearInterval(timer); },
  };
}
