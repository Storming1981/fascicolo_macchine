import type { DiaryPhase } from "@prisma/client";

/**
 * Date di cambio stato del fascicolo ("Date di stato" in Anagrafica e voci del
 * diario). Quando esiste un valore AUTOMATICO prevale e non si modifica a mano:
 * - production_start / production_end → gestionale: prima / ultima timbratura
 * - testing   → firma della check list di collaudo (approvazione, se manca
 *               quella del compilatore)
 * - shipped   → gestionale: DDT di scopo SUPPLY sulla commessa di vendita
 * - installed → ultimo rapportino dell'intervento di INSTALLAZIONE con
 *               commessa = job di vendita + 2 cifre (es. 1260354 → 126035401)
 * - service / scrapped → inserimento manuale
 * Collaudo e installazione si calcolano al volo (`milestoneAuto.ts`); le date
 * del gestionale sono MachineMilestone con source GESTIONALE.
 */
export type MilestoneKey =
  | "production_start"
  | "production_end"
  | "testing"
  | "shipped"
  | "installed"
  | "service"
  | "scrapped";

export type MilestoneSource = "GESTIONALE" | "COLLAUDO" | "INTERVENTO" | "MANUALE";

export const MILESTONES: {
  key: MilestoneKey;
  label: string;
  phase: DiaryPhase;
  /** Da dove arriva la data (sottotitolo nella card); vuoto = nessun sottotitolo. */
  hint: string;
}[] = [
  { key: "production_start", label: "Inizio produzione", phase: "PRODUCTION", hint: "" },
  { key: "production_end", label: "Fine produzione", phase: "PRODUCTION", hint: "Ultima timbratura" },
  { key: "testing", label: "Collaudo", phase: "TESTING", hint: "Firma check list di collaudo" },
  { key: "shipped", label: "Spedita", phase: "SHIPPED", hint: "DDT di fornitura (SUPPLY)" },
  { key: "installed", label: "Installata", phase: "INSTALLED", hint: "Ultimo rapportino di installazione" },
  { key: "service", label: "In esercizio", phase: "MAINTENANCE", hint: "Inserimento manuale" },
  { key: "scrapped", label: "Dismessa", phase: "SCRAPPED", hint: "Inserimento manuale" },
];

export const MILESTONE_KEYS = MILESTONES.map((m) => m.key);

export const SOURCE_LABEL: Record<string, string> = {
  GESTIONALE: "Gestionale",
  COLLAUDO: "Check list di collaudo",
  INTERVENTO: "Intervento di installazione",
  MANUALE: "Inserimento manuale",
};

/** Le date automatiche prevalgono e non si correggono dalla card. */
export function isAutoSource(source: string | null | undefined): boolean {
  return source === "GESTIONALE" || source === "COLLAUDO" || source === "INTERVENTO";
}

export function milestoneDef(key: string) {
  return MILESTONES.find((m) => m.key === key);
}
