import { prisma } from "./db";
import { machineProgress, type AnagraficaFields, type CollaudoState, type MachineProgress } from "./machineProgress";

/** Quanto serve per calcolare l'avanzamento: i campi anagrafici del fascicolo. */
export type ProgressMachine = AnagraficaFields & { id: string };

/**
 * Avanzamento di più fascicoli in due query: elenco macchine, dashboard e
 * scheda devono mostrare lo stesso numero, quindi passano tutti di qui invece
 * di calcolarselo ognuno coi dati che ha sottomano.
 *
 * Le matricole si contano in **SQL aggregato**: caricare gli slot di 195
 * fascicoli (oltre diecimila righe) per contarli in JavaScript sarebbe il modo
 * più lento di ottenere due numeri. Fuori gli slot di **sola foto** (scheda di
 * lubrificazione, carpenteria, cabina): non hanno un numero da trascrivere,
 * quindi contarli vorrebbe dire un fascicolo incompleto per sempre.
 */
export async function progressForMachines(machines: ProgressMachine[]): Promise<Map<string, MachineProgress>> {
  const out = new Map<string, MachineProgress>();
  if (!machines.length) return out;
  const ids = machines.map((m) => m.id);

  const [collaudi, serials] = await Promise.all([
    prisma.collaudo.findMany({ where: { machineId: { in: ids } }, select: { machineId: true, status: true } }),
    prisma.$queryRaw<{ machineId: string; total: bigint; filled: bigint }[]>`
      SELECT c."machineId", COUNT(*) AS total,
             COUNT(*) FILTER (WHERE COALESCE(BTRIM(i.serial), '') <> '') AS filled
      FROM "ComponentItem" i
      JOIN "Component" c ON c.id = i."componentId"
      WHERE c."machineId" = ANY(${ids}) AND i."photoOnly" = false
      GROUP BY c."machineId"`,
  ]);

  const cs = new Map(collaudi.map((c) => [c.machineId, c.status]));
  const ss = new Map(serials.map((r) => [r.machineId, { total: Number(r.total), filled: Number(r.filled) }]));

  for (const m of machines) {
    const st = cs.get(m.id);
    const collaudo: CollaudoState =
      st === "APPROVED" ? "APPROVED" : st === "PENDING_APPROVAL" ? "COMPILED" : st ? "DRAFT" : "NONE";
    out.set(
      m.id,
      machineProgress({
        anagrafica: m,
        serials: ss.get(m.id) ?? { filled: 0, total: 0 },
        collaudo,
      })
    );
  }
  return out;
}

export async function progressForMachine(m: ProgressMachine): Promise<MachineProgress> {
  const map = await progressForMachines([m]);
  return map.get(m.id) ?? { percent: 0, steps: [] };
}
