import { prisma } from "./db";
import { sheetKindsFor } from "./allestimento";
import { machineProgress, type CollaudoState, type MachineProgress, type MachineStatusLike } from "./machineProgress";

/**
 * Avanzamento di più fascicoli in quattro query sole: elenco macchine,
 * dashboard e scheda del fascicolo devono mostrare lo stesso numero, quindi
 * passano tutti di qui invece di calcolarselo ognuno coi dati che ha sottomano.
 */
export async function progressForMachines(
  machines: { id: string; plantType: string | null; status: MachineStatusLike }[]
): Promise<Map<string, MachineProgress>> {
  const out = new Map<string, MachineProgress>();
  if (!machines.length) return out;
  const ids = machines.map((m) => m.id);

  const [milestones, collaudi, sheets] = await Promise.all([
    prisma.machineMilestone.findMany({ where: { machineId: { in: ids } }, select: { machineId: true, key: true } }),
    prisma.collaudo.findMany({ where: { machineId: { in: ids } }, select: { machineId: true, status: true } }),
    prisma.allestimentoSheet.findMany({ where: { machineId: { in: ids } }, select: { machineId: true, status: true } }),
  ]);

  const byMachine = <T extends { machineId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.machineId, [...(m.get(r.machineId) ?? []), r]);
    return m;
  };
  const ms = byMachine(milestones);
  const cs = new Map(collaudi.map((c) => [c.machineId, c.status]));
  const sh = byMachine(sheets);

  for (const m of machines) {
    const st = cs.get(m.id);
    const collaudo: CollaudoState =
      st === "APPROVED" ? "APPROVED" : st === "PENDING_APPROVAL" ? "COMPILED" : st ? "DRAFT" : "NONE";
    const rows = sh.get(m.id) ?? [];
    out.set(
      m.id,
      machineProgress({
        status: m.status,
        milestones: (ms.get(m.id) ?? []).map((x) => x.key),
        sheets: {
          expected: sheetKindsFor(m.plantType).length,
          started: rows.filter((r) => r.status !== "SIGNED").length,
          signed: rows.filter((r) => r.status === "SIGNED").length,
        },
        collaudo,
      })
    );
  }
  return out;
}

export async function progressForMachine(m: {
  id: string;
  plantType: string | null;
  status: MachineStatusLike;
}): Promise<MachineProgress> {
  const map = await progressForMachines([m]);
  return map.get(m.id) ?? { percent: 0, steps: [] };
}
