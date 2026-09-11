import type { Role } from "@prisma/client";
import { ALL_ROLES } from "./permissions";

/**
 * Visibilità dei menu/sottomenu per ruolo. Puramente di navigazione (cosa vede
 * l'utente nella sidebar); l'accesso effettivo alle pagine/API resta comunque
 * governato dai permessi (userCan). Import e Impostazioni NON sono qui: restano
 * legati ai permessi machine.import / settings.manage.
 */
export type NavKey =
  | "dashboard"
  | "macchine"
  | "persone"
  | "service"
  | "interventi"
  | "chat"
  | "pianificazione"
  | "mappa"
  | "clienti"
  | "notifiche"
  | "knowledge";

export const NAV_ITEMS: { key: NavKey; label: string; group: string }[] = [
  { key: "dashboard", label: "Dashboard", group: "Fascicolo" },
  { key: "macchine", label: "Macchine", group: "Fascicolo" },
  { key: "service", label: "Service · Panoramica", group: "Service" },
  { key: "interventi", label: "Service · Interventi", group: "Service" },
  { key: "chat", label: "Service · Chat", group: "Service" },
  { key: "pianificazione", label: "Service · Pianificazione", group: "Service" },
  { key: "mappa", label: "Service · Mappa cantieri", group: "Service" },
  { key: "clienti", label: "Service · Clienti & Cantieri", group: "Service" },
  { key: "notifiche", label: "Service · Notifiche", group: "Service" },
  { key: "knowledge", label: "Knowledge ZATO", group: "Knowledge" },
  { key: "persone", label: "Persone & Firme", group: "Registro" },
];

export const NAV_KEYS = NAV_ITEMS.map((n) => n.key);

export type NavVisibility = Record<string, Partial<Record<NavKey, boolean>>>;

const ALL: NavKey[] = NAV_KEYS;
const on = (keys: NavKey[]): Partial<Record<NavKey, boolean>> =>
  Object.fromEntries(ALL.map((k) => [k, keys.includes(k)]));

/** Default di visibilità menu per ruolo. ADMIN vede sempre tutto. */
export const DEFAULT_NAV: NavVisibility = {
  ADMIN: on(ALL),
  RESPONSABILE_CANTIERI: on(ALL),
  CAPO_OFFICINA: on(ALL),
  // Responsabile produzione: fascicolo + panoramica service, senza le voci
  // operative del service (chat, pianificazione, notifiche).
  RESPONSABILE_PRODUZIONE: on([
    "dashboard",
    "macchine",
    "persone",
    "service",
    "interventi",
    "clienti",
    "knowledge",
  ]),
  MONTATORE: on(["dashboard", "macchine", "persone", "knowledge"]),
  CABLATORE: on(["dashboard", "macchine", "persone", "knowledge"]),
  PROGRAMMATORE: on(["dashboard", "macchine", "persone", "knowledge"]),
  COLLAUDATORE: on(["dashboard", "macchine", "persone", "service", "interventi", "knowledge"]),
  // Tecnico di campo: solo gli Interventi (+ knowledge di consultazione).
  TECNICO_CAMPO: on(["interventi", "knowledge"]),
  LOGISTICA: on(["dashboard", "macchine", "knowledge"]),
};

/** Completa la matrice fornita con i default per ruoli/voci mancanti. */
export function mergeNav(stored?: NavVisibility | null): NavVisibility {
  const out: NavVisibility = {};
  for (const role of ALL_ROLES) {
    out[role] = {};
    for (const k of NAV_KEYS) {
      const fromStored = stored?.[role]?.[k];
      out[role][k] =
        typeof fromStored === "boolean" ? fromStored : !!DEFAULT_NAV[role]?.[k];
    }
  }
  for (const k of NAV_KEYS) out.ADMIN[k] = true; // ADMIN sempre tutto
  return out;
}

/** L'utente (ruolo) vede la voce di menu? ADMIN sempre sì. */
export function navVisible(role: Role, key: NavKey, matrix: NavVisibility = DEFAULT_NAV): boolean {
  if (role === "ADMIN") return true;
  return !!matrix[role]?.[key];
}
