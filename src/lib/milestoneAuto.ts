import { prisma } from "./db";
import { MILESTONES, type MilestoneSource } from "./milestones";

/**
 * Date di stato calcolate dai dati dell'app (non dal gestionale), unite a
 * quelle salvate in MachineMilestone. Regola: il valore automatico prevale;
 * la data salvata (gestionale o inserita a mano) vale solo dove l'automatico
 * manca. Calcolate a ogni lettura, così non restano mai disallineate quando si
 * firma un collaudo o si chiude un rapportino.
 */

export type EffectiveMilestone = {
  key: string;
  date: Date;
  source: MilestoneSource | string;
  /** Dettaglio dell'origine (es. "INT-2493 · ultimo rapportino"). */
  detail: string | null;
};

type Auto = { date: Date; detail: string } | null;

/** Collaudo = firma della check list: approvazione, altrimenti compilatore. */
async function testingDate(machineId: string): Promise<Auto> {
  const c = await prisma.collaudo.findUnique({
    where: { machineId },
    select: { approvedAt: true, approverName: true, compiledAt: true, compilerName: true },
  });
  if (c?.approvedAt)
    return {
      date: c.approvedAt,
      detail: `Firma approvazione check list${c.approverName ? ` · ${c.approverName}` : ""}`,
    };
  if (c?.compiledAt)
    return {
      date: c.compiledAt,
      detail: `Firma compilatore check list${c.compilerName ? ` · ${c.compilerName}` : ""}`,
    };
  return null;
}

/**
 * Installata = data dell'ultimo rapportino (chiuso, se ce ne sono) degli
 * interventi di INSTALLAZIONE con commessa = job di vendita + 2 cifre
 * (1260354 → 126035401). Vale anche un'installazione collegata direttamente
 * al fascicolo quando la commessa non è compilata.
 */
async function installedDate(machine: { id: string; job: string }): Promise<Auto> {
  const job = (machine.job ?? "").trim();
  const numericJob = /^\d{4,}$/.test(job);
  const interventi = await prisma.intervento.findMany({
    where: {
      deletedAt: null,
      type: "INSTALLAZIONE",
      OR: [...(numericJob ? [{ commessa: { startsWith: job } }] : []), { machineId: machine.id }],
    },
    select: {
      code: true,
      commessa: true,
      machineId: true,
      rapportini: { select: { date: true, closed: true } },
    },
  });

  let best: Auto = null;
  for (const i of interventi) {
    const commessa = (i.commessa ?? "").trim();
    const byCommessa = numericJob && commessa.startsWith(job) && commessa.length === job.length + 2;
    const byMachine = i.machineId === machine.id && !commessa;
    if (!byCommessa && !byMachine) continue;
    const closed = i.rapportini.filter((r) => r.closed);
    for (const r of closed.length ? closed : i.rapportini) {
      if (!best || r.date > best.date) best = { date: r.date, detail: `${i.code} · ultimo rapportino` };
    }
  }
  return best;
}

export async function resolveMilestones(
  machine: { id: string; job: string },
  stored: { key: string; date: Date; source: string }[],
): Promise<EffectiveMilestone[]> {
  const [testing, installed] = await Promise.all([testingDate(machine.id), installedDate(machine)]);
  const computed: Record<string, { auto: Auto; source: MilestoneSource }> = {
    testing: { auto: testing, source: "COLLAUDO" },
    installed: { auto: installed, source: "INTERVENTO" },
  };

  const out: EffectiveMilestone[] = [];
  for (const def of MILESTONES) {
    const c = computed[def.key];
    if (c?.auto) {
      out.push({ key: def.key, date: c.auto.date, source: c.source, detail: c.auto.detail });
      continue;
    }
    const row = stored.find((s) => s.key === def.key);
    if (row) out.push({ key: row.key, date: row.date, source: row.source, detail: null });
  }
  return out;
}
