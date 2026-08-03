import { prisma } from "./db";

/**
 * Ricalcola i dati gestionale di una macchina dai dati GIÀ SINCRONIZZATI
 * (snapshot job + ordini selezionati + tabella ErpCommessaOrder), senza toccare
 * il gestionale. Serve sulla VPS: rende immediata la selezione di un ordine
 * (ore/date sommate al volo) invece di aspettare il giro del sync-agent.
 *
 * Riproduce la logica di getMachineErpData (src/lib/erp.ts).
 */

const GENERIC = "999999999";

type SnapJob = {
  job: string;
  found: boolean;
  description: string | null;
  customer: string | null;
  customerCountryIso: string | null;
  openedAt: string | null;
  closedAt: string | null;
  isClosed: boolean;
  productionStart: string | null;
  productionEnd: string | null;
  progressRows: number;
  hours: number;
};
type SnapArticle = {
  code: string | null;
  desc: string | null;
  hours: number;
  rows: number;
  start: string | null;
  end: string | null;
};
type SnapOrderData = {
  key: string;
  found: boolean;
  tipork: string;
  anno: number;
  serie: string;
  num: number;
  hours: number;
  start: string | null;
  end: string | null;
  articles: SnapArticle[];
};
type Snapshot = { jobs?: SnapJob[]; orders?: { role: string; data: SnapOrderData }[] };

export type ComputedErp = {
  jobs: SnapJob[];
  orders: { role: string; data: SnapOrderData }[];
  customer: string | null;
  customerCountryIso: string | null;
  description: string | null;
  productionStart: string | null;
  productionEnd: string | null;
  totalHours: number;
  hasProduction: boolean;
};

export async function computeErpFromSnapshot(id: string): Promise<ComputedErp | null> {
  const m = await prisma.machine.findUnique({
    where: { id },
    select: {
      erpSnapshot: true,
      jobBody: true,
      jobContainer: true,
      erpBodyOrder: true,
      erpContainerOrder: true,
      erpStandOrder: true,
      erpBladesOrder: true,
    },
  });
  if (!m || !m.erpSnapshot) return null;
  const snap = m.erpSnapshot as unknown as Snapshot;
  const jobs = snap.jobs ?? [];

  // ordini selezionati (ruolo → chiave)
  const sel = (
    [
      { role: "Corpo", key: m.erpBodyOrder },
      { role: "Container", key: m.erpContainerOrder },
      { role: "Cavalletto", key: m.erpStandOrder },
      { role: "Lame", key: m.erpBladesOrder },
    ] as { role: string; key: string | null }[]
  ).filter((x): x is { role: string; key: string } => !!x.key);

  const keys = sel.map((s) => s.key);
  const rows = keys.length
    ? await prisma.erpCommessaOrder.findMany({ where: { key: { in: keys } } })
    : [];
  const rowByKey = new Map(rows.map((o) => [o.key, o]));
  const snapOrdByKey = new Map((snap.orders ?? []).map((o) => [o.data.key, o.data]));

  const orders = sel.map((s) => {
    // preferisci lo snapshot (ha gli articoli) se contiene questo ordine,
    // altrimenti usa ErpCommessaOrder (ore/date fresche, senza articoli).
    const snapData = snapOrdByKey.get(s.key);
    const row = rowByKey.get(s.key);
    let data: SnapOrderData;
    if (snapData) {
      data = snapData;
    } else if (row) {
      data = {
        key: row.key,
        found: true,
        tipork: row.tipork,
        anno: row.anno,
        serie: row.serie,
        num: row.num,
        hours: row.hours,
        start: row.start ? row.start.toISOString() : null,
        end: row.end ? row.end.toISOString() : null,
        articles: [],
      };
    } else {
      data = { key: s.key, found: false, tipork: "", anno: 0, serie: "", num: 0, hours: 0, start: null, end: null, articles: [] };
    }
    return { role: s.role, data };
  });

  // aggregato (stessa logica di getMachineErpData)
  const starts: number[] = [];
  const ends: number[] = [];
  let totalHours = 0;
  let hasProduction = false;
  const bodyHasOrder = !!m.erpBodyOrder;
  const containerHasOrder = !!m.erpContainerOrder;

  for (const o of orders) {
    if (o.data.start) starts.push(new Date(o.data.start).getTime());
    if (o.data.end) ends.push(new Date(o.data.end).getTime());
    totalHours += o.data.hours || 0;
    if (o.data.hours > 0 || o.data.start) hasProduction = true;
  }
  for (const j of jobs) {
    if (!j.found || j.job === GENERIC) continue;
    const isBody = m.jobBody && j.job === String(m.jobBody).trim();
    const isContainer = m.jobContainer && j.job === String(m.jobContainer).trim();
    if (isBody && bodyHasOrder) continue;
    if (isContainer && containerHasOrder) continue;
    if (j.productionStart) starts.push(new Date(j.productionStart).getTime());
    if (j.productionEnd) ends.push(new Date(j.productionEnd).getTime());
    totalHours += j.hours || 0;
    if (j.progressRows > 0) hasProduction = true;
  }

  const found = jobs.filter((j) => j.found);
  const primary = found.find((j) => j.customer && j.job !== GENERIC) ?? found[0] ?? null;

  return {
    jobs,
    orders,
    customer: primary?.customer ?? null,
    customerCountryIso: primary?.customerCountryIso ?? null,
    description: primary?.description ?? null,
    productionStart: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    productionEnd: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
    totalHours: Math.round(totalHours * 100) / 100,
    hasProduction,
  };
}
