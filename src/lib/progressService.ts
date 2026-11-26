import { prisma } from "./db";
import { hiddenGroupIds, machineSheetKinds } from "./allestimento";
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
 * quindi contarli vorrebbe dire un fascicolo incompleto per sempre. Fuori
 * anche i componenti **esclusi** (N.A. in scheda: riduttori o motori che non
 * si spediscono con la macchina), per la stessa ragione.
 *
 * **Si conta solo quello che il fascicolo mostra** (`hiddenGroupIds`): i
 * gruppi che nessuna sua scheda nomina non si compilano da nessuna parte. La
 * query dell'aggregato diventa quindi **una per composizione di schede** (solo
 * corpo, solo container, corpo + container, mulino, …) e non una per
 * fascicolo: i gruppi nascosti dipendono dalla tipologia e dalle schede, non
 * dalla singola macchina.
 */
export async function progressForMachines(machines: ProgressMachine[]): Promise<Map<string, MachineProgress>> {
  const out = new Map<string, MachineProgress>();
  if (!machines.length) return out;
  const ids = machines.map((m) => m.id);

  // Una passata per composizione di schede: i gruppi da escludere sono gli
  // stessi per tutti i fascicoli fatti allo stesso modo.
  const batches = new Map<string, { deny: string[]; ids: string[] }>();
  for (const m of machines) {
    const deny = hiddenGroupIds(m.plantType, m.sheetKinds).sort();
    const key = deny.join(",");
    const b = batches.get(key) ?? { deny, ids: [] };
    b.ids.push(m.id);
    batches.set(key, b);
  }

  const [collaudi, sheets, ...counts] = await Promise.all([
    prisma.collaudo.findMany({ where: { machineId: { in: ids } }, select: { machineId: true, status: true } }),
    prisma.allestimentoSheet.findMany({
      where: { machineId: { in: ids }, status: "SIGNED" },
      select: { machineId: true, kind: true },
    }),
    ...[...batches.values()].map(
      (b) => prisma.$queryRaw<{ machineId: string; total: bigint; filled: bigint }[]>`
      SELECT c."machineId", COUNT(*) AS total,
             COUNT(*) FILTER (WHERE COALESCE(BTRIM(i.serial), '') <> '') AS filled
      FROM "ComponentItem" i
      JOIN "Component" c ON c.id = i."componentId"
      WHERE c."machineId" = ANY(${b.ids}) AND i."photoOnly" = false AND c.excluded = false
        AND NOT (c."groupId" = ANY(${b.deny.length ? b.deny : [""]}))
      GROUP BY c."machineId"`
    ),
  ]);

  const cs = new Map(collaudi.map((c) => [c.machineId, c.status]));
  const ss = new Map(
    counts.flat().map((r) => [r.machineId, { total: Number(r.total), filled: Number(r.filled) }])
  );
  // Una scheda firmata che il fascicolo non comprende piu' non conta: resta in
  // banca dati (toglierla dal fascicolo non cancella niente) ma non e' lavoro
  // fatto su questa commessa.
  const signed = new Map<string, number>();
  for (const m of machines) {
    const kinds = machineSheetKinds(m.plantType, m.sheetKinds);
    const mine = new Set<string>(kinds);
    signed.set(m.id, sheets.filter((s) => s.machineId === m.id && mine.has(s.kind)).length);
  }

  for (const m of machines) {
    const st = cs.get(m.id);
    const collaudo: CollaudoState =
      st === "APPROVED" ? "APPROVED" : st === "PENDING_APPROVAL" ? "COMPILED" : st ? "DRAFT" : "NONE";
    out.set(
      m.id,
      machineProgress({
        anagrafica: m,
        serials: ss.get(m.id) ?? { filled: 0, total: 0 },
        signedSheets: signed.get(m.id) ?? 0,
        collaudo,
      })
    );
  }
  return out;
}

export async function progressForMachine(m: ProgressMachine): Promise<MachineProgress> {
  const map = await progressForMachines([m]);
  return map.get(m.id) ?? { percent: 0, steps: [], serials: { filled: 0, total: 0 } };
}
