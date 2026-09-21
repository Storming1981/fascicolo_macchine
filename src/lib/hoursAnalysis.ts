import "server-only";
import { prisma } from "./db";
import { getMachineErpData, isErpConfigured } from "./erp";
import { computeErpFromSnapshot } from "./erpSnapshot";

/**
 * Analisi ore di un fascicolo: PRODUZIONE (gestionale, avanzamenti `avlavp`)
 * + CANTIERE (timbratore esterno, copia locale in `Stamping`).
 *
 * Come una timbratura si aggancia al fascicolo — il timbratore non conosce la
 * macchina, solo il codice commessa:
 *  - `job`          codice == job / jobBody / jobContainer (7 cifre: 1250376)
 *  - `cantiere`     codice == job + 2 cifre (126035401 = installazione di 1260354)
 *  - `intervento`   codice == commessa di un intervento di service sul fascicolo
 *  - `descrizione`  il job compare nel nome della commessa di service
 *                   ("CAMBIO LAME GF4000.II 1230155"): l'unico legame che le
 *                   commesse 2…/4… hanno con la macchina.
 * La commessa generica 999999999 non si aggancia mai: raccoglie macchine diverse.
 */

export type SiteLink = "job" | "cantiere" | "intervento" | "descrizione";

export type SiteCommessa = {
  code: string;
  description: string | null;
  customer: string | null;
  link: SiteLink;
  /** Vendita / Corpo / Container, oppure il codice intervento (INT-…). */
  ref: string | null;
  hours: number;
  work: number;
  travel: number;
  other: number;
  stampings: number;
  operators: number;
  first: string | null;
  last: string | null;
  open: number;
};

export type HoursAnalysis = {
  production: {
    total: number;
    /** erp = gestionale in diretta · snapshot = dati del sync-agent · saved = solo ore salvate */
    source: "erp" | "snapshot" | "saved" | null;
    start: string | null;
    end: string | null;
    parts: { label: string; code: string; hours: number }[];
    error?: string;
  };
  site: {
    total: number;
    work: number;
    travel: number;
    other: number;
    commesse: SiteCommessa[];
    operators: { name: string; matricola: string | null; hours: number; work: number; travel: number }[];
    months: { month: string; work: number; travel: number; other: number }[];
    first: string | null;
    last: string | null;
  };
  total: number;
  /** Ultimo aggiornamento della copia locale delle timbrature. */
  syncedAt: string | null;
  /** Il timbratore è configurato su questo server. */
  feedConfigured: boolean;
};

const GENERIC = "999999999";
const r1 = (n: number) => Math.round(n * 100) / 100;

function kindOf(tipologia: string | null): "work" | "travel" | "other" {
  const t = (tipologia ?? "").toLowerCase();
  if (t.startsWith("viagg")) return "travel";
  if (t.startsWith("lavor") || !t) return "work";
  return "other";
}

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

async function productionHours(machine: {
  id: string;
  job: string | null;
  jobBody: string | null;
  jobContainer: string | null;
  erpBodyOrder: string | null;
  erpContainerOrder: string | null;
  erpStandOrder: string | null;
  erpBladesOrder: string | null;
  erpHours: number | null;
  productionStart: Date | null;
}): Promise<HoursAnalysis["production"]> {
  const roleOf = (job: string) =>
    [
      machine.job === job && "Vendita",
      machine.jobBody === job && "Corpo",
      machine.jobContainer === job && "Container",
    ]
      .filter(Boolean)
      .join(" / ") || "Commessa";

  type Src = {
    jobs: { job: string; found: boolean; hours: number }[];
    orders: { role: string; data: { found: boolean; tipork: string; anno: number; num: number; hours: number } }[];
    totalHours: number;
    productionStart: Date | string | null;
    productionEnd: Date | string | null;
  };
  const shape = (d: Src, source: "erp" | "snapshot"): HoursAnalysis["production"] => ({
    total: r1(d.totalHours),
    source,
    start: d.productionStart ? new Date(d.productionStart).toISOString() : null,
    end: d.productionEnd ? new Date(d.productionEnd).toISOString() : null,
    parts: [
      ...d.jobs
        .filter((j) => j.found && j.hours > 0)
        .map((j) => ({ label: roleOf(j.job), code: j.job, hours: r1(j.hours) })),
      ...d.orders
        .filter((o) => o.data.found && o.data.hours > 0)
        .map((o) => ({
          label: `Ordine ${o.role}`,
          code: `${o.data.tipork}/${o.data.anno}/${o.data.num}`,
          hours: r1(o.data.hours),
        })),
    ],
  });

  let error: string | undefined;
  if (isErpConfigured()) {
    try {
      const d = await getMachineErpData({
        job: machine.job,
        jobBody: machine.jobBody,
        jobContainer: machine.jobContainer,
        bodyOrder: machine.erpBodyOrder,
        containerOrder: machine.erpContainerOrder,
        standOrder: machine.erpStandOrder,
        bladesOrder: machine.erpBladesOrder,
      });
      return shape(d, "erp");
    } catch (e) {
      error = e instanceof Error ? e.message : "Gestionale non raggiungibile";
    }
  }
  const snap = await computeErpFromSnapshot(machine.id).catch(() => null);
  if (snap && snap.jobs.some((j) => j.found)) return { ...shape(snap, "snapshot"), error };
  return {
    total: r1(machine.erpHours ?? 0),
    source: machine.erpHours ? "saved" : null,
    start: machine.productionStart?.toISOString() ?? null,
    end: null,
    parts: [],
    error,
  };
}

export async function machineHoursAnalysis(machineId: string): Promise<HoursAnalysis | null> {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: {
      id: true,
      job: true,
      jobBody: true,
      jobContainer: true,
      erpBodyOrder: true,
      erpContainerOrder: true,
      erpStandOrder: true,
      erpBladesOrder: true,
      erpHours: true,
      productionStart: true,
      interventi: { where: { commessa: { not: null } }, select: { code: true, commessa: true } },
    },
  });
  if (!machine) return null;

  // job numerici del fascicolo (i formati liberi tipo "ordine 72" non timbrano)
  const jobs = new Map<string, string>(); // job → ruolo
  for (const [j, role] of [
    [machine.job, "Vendita"],
    [machine.jobBody, "Corpo"],
    [machine.jobContainer, "Container"],
  ] as const) {
    const v = (j ?? "").trim();
    if (!/^\d{5,}$/.test(v) || v === GENERIC) continue;
    jobs.set(v, jobs.has(v) ? `${jobs.get(v)} / ${role}` : role);
  }
  const intByCode = new Map<string, string>();
  for (const i of machine.interventi) {
    const c = (i.commessa ?? "").trim();
    if (c && c !== GENERIC) intByCode.set(c, intByCode.has(c) ? `${intByCode.get(c)}, ${i.code}` : i.code);
  }

  const jobList = [...jobs.keys()];
  const or = [
    ...(jobList.length ? [{ commessa: { in: jobList } }] : []),
    ...jobList.map((j) => ({ commessa: { startsWith: j } })),
    ...jobList.filter((j) => j.length >= 7).map((j) => ({ description: { contains: j } })),
    ...(intByCode.size ? [{ commessa: { in: [...intByCode.keys()] } }] : []),
  ];
  const rows = or.length
    ? await prisma.stamping.findMany({ where: { OR: or }, orderBy: { startedAt: "asc" } })
    : [];

  // classificazione: il legame più diretto vince (job > cantiere > intervento > descrizione)
  const linkOf = (code: string, description: string | null): { link: SiteLink; ref: string | null } | null => {
    if (jobs.has(code)) return { link: "job", ref: jobs.get(code)! };
    for (const [j, role] of jobs)
      if (code.length === j.length + 2 && code.startsWith(j) && /^\d+$/.test(code))
        return { link: "cantiere", ref: intByCode.get(code) ?? role };
    if (intByCode.has(code)) return { link: "intervento", ref: intByCode.get(code)! };
    for (const j of jobList)
      if (j.length >= 7 && new RegExp(`(^|\\D)${j}(\\d{2})?(\\D|$)`).test(description ?? ""))
        return { link: "descrizione", ref: jobs.get(j)! };
    return null;
  };

  const byCode = new Map<string, SiteCommessa & { ops: Set<string> }>();
  const byOp = new Map<string, HoursAnalysis["site"]["operators"][number]>();
  const byMonth = new Map<string, { work: number; travel: number; other: number }>();
  let work = 0;
  let travel = 0;
  let other = 0;
  let first: Date | null = null;
  let last: Date | null = null;

  for (const s of rows) {
    const code = (s.commessa ?? "").trim();
    if (!code) continue;
    const l = linkOf(code, s.description);
    if (!l) continue;
    const k = kindOf(s.tipologia);
    const h = s.hours;
    if (k === "work") work += h;
    else if (k === "travel") travel += h;
    else other += h;

    let c = byCode.get(code);
    if (!c) {
      c = {
        code,
        description: s.description,
        customer: s.anagrafica,
        link: l.link,
        ref: l.ref,
        hours: 0,
        work: 0,
        travel: 0,
        other: 0,
        stampings: 0,
        operators: 0,
        first: null,
        last: null,
        open: 0,
        ops: new Set(),
      };
      byCode.set(code, c);
    }
    c.hours += h;
    c[k] += h;
    c.stampings++;
    if (s.open) c.open++;
    if (s.operator) c.ops.add(s.operator);
    if (s.startedAt) {
      const iso = s.startedAt.toISOString();
      if (!c.first || iso < c.first) c.first = iso;
      if (!c.last || iso > c.last) c.last = iso;
      if (!first || s.startedAt < first) first = s.startedAt;
      if (!last || s.startedAt > last) last = s.startedAt;
      const m = byMonth.get(monthOf(s.startedAt)) ?? { work: 0, travel: 0, other: 0 };
      m[k] += h;
      byMonth.set(monthOf(s.startedAt), m);
    }

    const opKey = s.matricola || s.operator || "?";
    const op = byOp.get(opKey) ?? { name: s.operator || `Matricola ${s.matricola}`, matricola: s.matricola, hours: 0, work: 0, travel: 0 };
    op.hours += h;
    if (k === "work") op.work += h;
    if (k === "travel") op.travel += h;
    byOp.set(opKey, op);
  }

  const site: HoursAnalysis["site"] = {
    total: r1(work + travel + other),
    work: r1(work),
    travel: r1(travel),
    other: r1(other),
    commesse: [...byCode.values()]
      .map(({ ops, ...c }) => ({
        ...c,
        operators: ops.size,
        hours: r1(c.hours),
        work: r1(c.work),
        travel: r1(c.travel),
        other: r1(c.other),
      }))
      .sort((a, b) => (a.first ?? "").localeCompare(b.first ?? "")),
    operators: [...byOp.values()]
      .map((o) => ({ ...o, hours: r1(o.hours), work: r1(o.work), travel: r1(o.travel) }))
      .sort((a, b) => b.hours - a.hours),
    months: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, work: r1(v.work), travel: r1(v.travel), other: r1(v.other) })),
    first: first?.toISOString() ?? null,
    last: last?.toISOString() ?? null,
  };

  const production = await productionHours(machine);
  const synced = await prisma.stamping.aggregate({ _max: { syncedAt: true } });

  return {
    production,
    site,
    total: r1(production.total + site.total),
    syncedAt: synced._max.syncedAt?.toISOString() ?? null,
    feedConfigured: Boolean(process.env.PRESENCE_FEED_URL),
  };
}
