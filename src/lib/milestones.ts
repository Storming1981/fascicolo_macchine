import type { DiaryPhase } from "@prisma/client";

/**
 * Date di cambio stato registrate nel diario macchina.
 * Per ora inserite a mano; in futuro alimentate dal gestionale ZATO:
 * - produzione inizio/fine = prima/ultima timbratura
 * - collaudo = ordini di produzione
 * - spedita = data DDT
 * - installata / esercizio / dismessa = manuale
 */
export type MilestoneKey =
  | "production_start"
  | "production_end"
  | "testing"
  | "shipped"
  | "installed"
  | "service"
  | "scrapped";

export const MILESTONES: {
  key: MilestoneKey;
  label: string;
  phase: DiaryPhase;
  hint: string;
  futureSource: string;
}[] = [
  {
    key: "production_start",
    label: "Inizio produzione",
    phase: "PRODUCTION",
    hint: "Prima timbratura",
    futureSource: "Gestionale (prima timbratura)",
  },
  {
    key: "production_end",
    label: "Fine produzione",
    phase: "PRODUCTION",
    hint: "Ultima timbratura",
    futureSource: "Gestionale (ultima timbratura)",
  },
  {
    key: "testing",
    label: "Collaudo",
    phase: "TESTING",
    hint: "Da ordini di produzione",
    futureSource: "Ordini di produzione",
  },
  {
    key: "shipped",
    label: "Spedita",
    phase: "SHIPPED",
    hint: "Data riferimento DDT",
    futureSource: "DDT",
  },
  {
    key: "installed",
    label: "Installata",
    phase: "INSTALLED",
    hint: "Inserimento manuale",
    futureSource: "Manuale",
  },
  {
    key: "service",
    label: "In esercizio",
    phase: "MAINTENANCE",
    hint: "Inserimento manuale",
    futureSource: "Manuale",
  },
  {
    key: "scrapped",
    label: "Dismessa",
    phase: "SCRAPPED",
    hint: "Inserimento manuale",
    futureSource: "Manuale",
  },
];

export const MILESTONE_KEYS = MILESTONES.map((m) => m.key);

export function milestoneDef(key: string) {
  return MILESTONES.find((m) => m.key === key);
}
