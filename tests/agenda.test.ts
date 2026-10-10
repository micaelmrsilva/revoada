// Relógio dos pedidos agendados, sem esperar o relógio de verdade.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createSchedules, nextRun } from "../schedule";

const at = (iso: string) => new Date(iso).getTime(); // hora local
const base = { prompt: "p", target: "t", cwd: "/", mode: "edit", brain: true, isolate: false };

test("próxima hora: uma vez, todo dia e dias escolhidos", () => {
  const seg = at("2026-10-12T10:00:00"); // segunda-feira
  expect(nextRun({ kind: "once", at: seg + 1000 }, seg)).toBe(seg + 1000);
  expect(nextRun({ kind: "once", at: seg - 1000 }, seg)).toBeNull();
  expect(nextRun({ kind: "daily", time: "15:30" }, seg)).toBe(at("2026-10-12T15:30:00"));
  expect(nextRun({ kind: "daily", time: "03:00" }, seg)).toBe(at("2026-10-13T03:00:00")); // hoje já passou
  expect(nextRun({ kind: "daily", time: "09:00", days: [5] }, seg)).toBe(at("2026-10-16T09:00:00")); // só sexta
  expect(nextRun({ kind: "daily", time: "09:00", days: [1] }, seg)).toBe(at("2026-10-19T09:00:00")); // segunda que vem
  for (const time of ["25:00", "9h", "", "12:99"]) expect(nextRun({ kind: "daily", time }, seg)).toBeNull();
});

test("roda quando a hora chega, uma vez só; hora perdida por pouco roda, por muito pula", async () => {
  const dir = mkdtempSync(join(tmpdir(), "revoada-agenda-"));
  let now = at("2026-10-12T10:00:00");
  const ran: string[] = [];
  const s = createSchedules({ file: join(dir, "s.json"), now: () => now, run: async (x) => { ran.push(x.prompt); return "c1"; } });
  try {
    const once = s.add({ ...base, prompt: "uma vez", kind: "once", at: now + 60_000 });
    const daily = s.add({ ...base, prompt: "todo dia", kind: "daily", time: "11:00" });
    s.tick();
    expect(ran).toEqual([]);
    now += 61_000; s.tick(); s.tick(); // dois tiques seguidos não disparam duas vezes
    await Bun.sleep(5);
    expect(ran).toEqual(["uma vez"]);
    expect([once.enabled, once.next, once.last?.convo]).toEqual([false, null, "c1"]);
    // o Mac dormiu: volta 2h depois da hora, ainda vale; a próxima já é a de amanhã
    now = at("2026-10-12T13:00:00"); s.tick();
    await Bun.sleep(5);
    expect(ran).toEqual(["uma vez", "todo dia"]);
    expect(daily.next).toBe(at("2026-10-13T11:00:00"));
    // dois dias fora: a hora de ontem não é rodada com atraso, só anotada
    now = at("2026-10-14T20:00:00"); s.tick();
    await Bun.sleep(5);
    expect(ran.length).toBe(2);
    expect(daily.last?.missed).toBe(true);
    expect(daily.next).toBe(at("2026-10-15T11:00:00"));
    // erro ao abrir a conversa fica registrado no agendamento
    const bad = createSchedules({ file: join(dir, "b.json"), now: () => now, run: async () => { throw new Error("a pasta deste pedido não existe mais"); } });
    const b = bad.add({ ...base, kind: "once", at: now + 1000 });
    now += 2000; bad.tick();
    await Bun.sleep(5);
    expect(b.last?.error).toContain("não existe mais");
    bad.stop();
  } finally { s.stop(); rmSync(dir, { recursive: true, force: true }); }
});
