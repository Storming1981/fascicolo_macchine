// Avanzamento del fascicolo: quanto è COMPLETO, non a che punto è la macchina.
//
// Prima era un cursore spostato a mano (fermo a 0 su tutta la flotta), poi una
// somma di date di stato — ma lo stato della macchina lo si legge già dalla
// colonna *Stato*, e ripeterlo in una barra non aggiungeva niente. Il dato che
// serve davvero è **quanto manca da compilare**, e il committente l'ha diviso
// nelle tre cose che si compilano a mano:
//
//   Anagrafica · Componenti e matricole · Collaudo
//
// Pesano uguale: un fascicolo con l'anagrafica piena ma senza matricole è
// completo per un terzo, ed è esattamente quello che si vuole vedere.
//
// Modulo puro (client + server): niente import server-only.

import { jobFields } from "./plant";

export type CollaudoState = "NONE" | "DRAFT" | "COMPILED" | "APPROVED";

/**
 * Campi dell'anagrafica che contano come "compilati": quelli delle due card che
 * si riempiono a mano (*Anagrafica macchina* e *Cliente e destinazione*) più
 * gli **ordini di produzione** agganciati in *Analisi ore*. Fuori la targa
 * tecnica (i suoi dati stanno nelle schede di allestimento) e i documenti, che
 * sono allegati e non campi.
 */
export type AnagraficaFields = {
  plantType: string | null;
  model: string | null;
  year: number | null;
  job: string | null;
  jobBody: string | null;
  jobContainer: string | null;
  customer: string | null;
  country: string | null;
  site: string | null;
  productionStart: Date | string | null;
  deliveryDate: Date | string | null;
  erpBodyOrder: string | null;
  erpContainerOrder: string | null;
};

/** Commessa generica degli impianti nuovi: lì l'ordine di produzione serve. */
const STOCK_COMMESSA = "999999999";

export type ProgressFacts = {
  anagrafica: AnagraficaFields;
  /** Slot componente del fascicolo e quanti hanno una matricola. */
  serials: { filled: number; total: number };
  collaudo: CollaudoState;
};

export type ProgressStep = {
  key: string;
  label: string;
  weight: number;
  /** 0 = da fare, 1 = fatto. */
  done: number;
  /** Dettaglio leggibile ("12 di 20 matricole"). */
  detail: string;
};

const has = (v: unknown) => (typeof v === "number" ? !!v : !!(v && String(v).trim()));

/** Le card dell'Anagrafica, così ognuna può mostrare il proprio contatore. */
export type AnagraficaGroup = "macchina" | "cliente" | "ordini";
export type AnagraficaField = { key: string; label: string; group: AnagraficaGroup; filled: boolean };

/**
 * Ordini di produzione da agganciare: si chiedono **solo dove servono**, cioè
 * sugli impianti nuovi, che stanno tutti sotto la commessa di stock. Chi ha una
 * commessa sua non deve restare incompleto per un campo che non lo riguarda.
 */
export function ordiniRequired(a: {
  plantType: string | null;
  jobBody: string | null;
  jobContainer: string | null;
  erpBodyOrder: string | null;
  erpContainerOrder: string | null;
}): AnagraficaField[] {
  const out: AnagraficaField[] = [];
  const jobs = jobFields(a.plantType);
  for (const f of jobs) {
    if ((a[f.key] ?? "").trim() !== STOCK_COMMESSA) continue;
    const key = f.key === "jobBody" ? "erpBodyOrder" : "erpContainerOrder";
    const role = f.key === "jobBody" ? (jobs.length > 1 ? "Corpo" : "Produzione") : "Container";
    out.push({ key, label: `Ordine ${role}`, group: "ordini", filled: has(a[key]) });
  }
  return out;
}

/**
 * I campi anagrafici che contano come "compilati", uno per uno: così la card
 * può dire quanti ne mancano e quali, come fanno le schede di allestimento.
 * I job seguono il **layout della tipologia** (`jobFields`): sui BLUE DEVIL
 * corpo + container, sulle altre il solo Job Pro.
 */
export function anagraficaFields(a: AnagraficaFields): AnagraficaField[] {
  const f = (key: string, label: string, group: AnagraficaGroup, value: unknown): AnagraficaField => ({
    key,
    label,
    group,
    filled: has(value),
  });
  return [
    f("plantType", "Tipologia impianto", "macchina", a.plantType),
    f("model", "Modello", "macchina", a.model),
    f("job", "Job Number", "macchina", a.job),
    ...jobFields(a.plantType).map((j) => f(j.key, j.label, "macchina", a[j.key])),
    f("year", "Anno", "macchina", a.year),
    f("customer", "Cliente", "cliente", a.customer),
    f("country", "Paese", "cliente", a.country),
    f("site", "Sito", "cliente", a.site),
    f("productionStart", "Inizio produzione", "cliente", a.productionStart),
    f("deliveryDate", "Data consegna", "cliente", a.deliveryDate),
    ...ordiniRequired(a),
  ];
}

export function groupScore(fields: AnagraficaField[], group: AnagraficaGroup) {
  const g = fields.filter((x) => x.group === group);
  return { done: g.filter((x) => x.filled).length, total: g.length, missing: g.filter((x) => !x.filled) };
}

export function anagraficaScore(a: AnagraficaFields): { done: number; total: number } {
  const fields = anagraficaFields(a);
  return { done: fields.filter((x) => x.filled).length, total: fields.length };
}

const COLLAUDO_SCORE: Record<CollaudoState, number> = {
  NONE: 0,
  DRAFT: 0.4,
  COMPILED: 0.7,
  APPROVED: 1,
};
const COLLAUDO_LABEL: Record<CollaudoState, string> = {
  NONE: "da compilare",
  DRAFT: "in compilazione",
  COMPILED: "in attesa di approvazione",
  APPROVED: "approvato",
};

export function progressSteps(f: ProgressFacts): ProgressStep[] {
  const a = anagraficaScore(f.anagrafica);
  const s = f.serials;
  return [
    {
      key: "anagrafica",
      label: "Anagrafica",
      weight: 1,
      done: a.total ? a.done / a.total : 1,
      detail: `${a.done} di ${a.total} campi`,
    },
    {
      key: "componenti",
      label: "Componenti e matricole",
      weight: 1,
      done: s.total ? s.filled / s.total : 0,
      detail: s.total ? `${s.filled} di ${s.total} matricole` : "nessuno slot censito",
    },
    {
      key: "collaudo",
      label: "Collaudo",
      weight: 1,
      done: COLLAUDO_SCORE[f.collaudo],
      detail: COLLAUDO_LABEL[f.collaudo],
    },
  ];
}

export function progressPercent(steps: ProgressStep[]): number {
  const total = steps.reduce((acc, s) => acc + s.weight, 0);
  if (!total) return 0;
  return Math.round((steps.reduce((acc, s) => acc + s.weight * s.done, 0) / total) * 100);
}

export type MachineProgress = { percent: number; steps: ProgressStep[] };

export function machineProgress(f: ProgressFacts): MachineProgress {
  const steps = progressSteps(f);
  return { percent: progressPercent(steps), steps };
}
