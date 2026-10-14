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

/**
 * Quota dei campi anagrafici compilati. Job corpo e container contano **solo
 * sui BLUE DEVIL**: sulle altre tipologie non esistono, e chiederli
 * abbasserebbe per sempre l'avanzamento di fascicoli completi.
 */
export function anagraficaScore(a: AnagraficaFields): { done: number; total: number } {
  const fields: unknown[] = [
    a.plantType,
    a.model,
    a.year,
    a.job,
    a.customer,
    a.country,
    a.site,
    a.productionStart,
    a.deliveryDate,
  ];
  if (a.plantType === "BLUE DEVIL") fields.push(a.jobBody, a.jobContainer);
  // L'ordine di produzione si chiede solo dove serve: sugli impianti nuovi,
  // che stanno tutti sotto la commessa di stock. Chi ha una commessa sua non
  // deve restare incompleto per un campo che non lo riguarda.
  if ((a.jobBody ?? "").trim() === STOCK_COMMESSA) fields.push(a.erpBodyOrder);
  if ((a.jobContainer ?? "").trim() === STOCK_COMMESSA) fields.push(a.erpContainerOrder);
  return { done: fields.filter(has).length, total: fields.length };
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
