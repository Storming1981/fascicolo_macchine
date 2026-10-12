// Avanzamento del fascicolo: calcolato dai fatti, non più spostato a mano.
//
// Il cursore manuale diceva solo quanto qualcuno si era ricordato di muoverlo:
// su 194 fascicoli era fermo a 0 o a un numero vecchio, quindi la barra in
// elenco e in dashboard non significava niente. Qui l'avanzamento è la somma
// pesata di passaggi che il fascicolo registra già da solo (date di stato dal
// gestionale, schede di allestimento, check list di collaudo).
//
// Regola importante: **lo stato della macchina implica il passaggio e i
// precedenti**: marcare "Spedita" vuol dire che la spedizione c'e' stata.
// Un fascicolo marcato "Spedita" ha per forza finito produzione e collaudo,
// anche se quei passaggi non sono mai stati registrati nell'app — è il caso dei
// 187 fascicoli importati dal file MATRICOLE, che altrimenti resterebbero a
// metà barra pur essendo in esercizio da anni.
//
// Modulo puro (client + server): niente import server-only.

import { STATUS_ORDER } from "./domain";

export type MachineStatusLike = (typeof STATUS_ORDER)[number];

export type CollaudoState = "NONE" | "DRAFT" | "COMPILED" | "APPROVED";

export type ProgressFacts = {
  status: MachineStatusLike;
  /** Chiavi delle date di stato presenti (MachineMilestone + calcolate). */
  milestones: string[];
  /** Schede di allestimento previste per la tipologia, avviate e firmate. */
  sheets: { expected: number; started: number; signed: number };
  collaudo: CollaudoState;
};

export type ProgressStep = {
  key: string;
  label: string;
  weight: number;
  /** 0 = da fare, 1 = fatto, valori intermedi per i passaggi parziali. */
  done: number;
  /** Il passaggio è dato per fatto dallo stato del fascicolo, non registrato. */
  implied: boolean;
};

const rank = (s: MachineStatusLike) => STATUS_ORDER.indexOf(s);
const from = (status: MachineStatusLike, min: MachineStatusLike) => rank(status) >= rank(min);

export function progressSteps(f: ProgressFacts): ProgressStep[] {
  const has = (k: string) => f.milestones.includes(k);
  const sheetsDone = f.sheets.expected
    ? Math.min(1, (f.sheets.signed + f.sheets.started * 0.5) / f.sheets.expected)
    : 0;

  const steps: { key: string; label: string; weight: number; raw: number; implied: MachineStatusLike | null }[] = [
    { key: "open", label: "Fascicolo aperto", weight: 5, raw: 1, implied: null },
    { key: "production_start", label: "Produzione iniziata", weight: 15, raw: has("production_start") ? 1 : 0, implied: "TESTING" },
    ...(f.sheets.expected
      ? [{ key: "sheets", label: "Schede di allestimento", weight: 20, raw: sheetsDone, implied: "SHIPPED" as MachineStatusLike }]
      : []),
    { key: "production_end", label: "Produzione conclusa", weight: 15, raw: has("production_end") ? 1 : 0, implied: "TESTING" },
    {
      key: "collaudo",
      label: "Check list di collaudo compilata",
      weight: 10,
      raw: f.collaudo === "COMPILED" || f.collaudo === "APPROVED" ? 1 : f.collaudo === "DRAFT" ? 0.4 : 0,
      implied: "SHIPPED",
    },
    { key: "collaudo_ok", label: "Collaudo approvato", weight: 10, raw: f.collaudo === "APPROVED" || has("testing") ? 1 : 0, implied: "SHIPPED" },
    { key: "shipped", label: "Spedita", weight: 15, raw: has("shipped") ? 1 : 0, implied: "SHIPPED" },
    { key: "installed", label: "Installata", weight: 10, raw: has("installed") ? 1 : 0, implied: "INSTALLED" },
  ];

  return steps.map((s) => {
    const implied = !!s.implied && s.raw < 1 && from(f.status, s.implied);
    return { key: s.key, label: s.label, weight: s.weight, done: implied ? 1 : s.raw, implied };
  });
}

export function progressPercent(steps: ProgressStep[]): number {
  const total = steps.reduce((a, s) => a + s.weight, 0);
  if (!total) return 0;
  return Math.round((steps.reduce((a, s) => a + s.weight * s.done, 0) / total) * 100);
}

export type MachineProgress = { percent: number; steps: ProgressStep[] };

export function machineProgress(f: ProgressFacts): MachineProgress {
  const steps = progressSteps(f);
  return { percent: progressPercent(steps), steps };
}
