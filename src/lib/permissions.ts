import type { Role } from "@prisma/client";
import { ROLE_LABEL } from "./domain";

export type PermAction =
  | "machine.create"
  | "machine.edit"
  | "machine.intervention"
  | "machine.sign"
  | "machine.import"
  | "users.manage"
  | "settings.manage"
  | "service.view"
  | "intervento.viewAll"
  | "intervento.create"
  | "intervento.edit"
  | "intervento.sign"
  | "customer.manage"
  | "chat.send"
  | "chat.import"
  | "knowledge.view"
  | "knowledge.manage"
  | "knowledge.ask"
  | "checklist.manage";

export const PERM_ACTIONS: { key: PermAction; label: string }[] = [
  { key: "machine.create", label: "Creare fascicoli macchina" },
  { key: "machine.edit", label: "Modificare stato / avanzamento" },
  { key: "machine.intervention", label: "Registrare interventi nel diario" },
  { key: "machine.sign", label: "Apporre firme (collaudo/intervento)" },
  { key: "machine.import", label: "Import massivo Excel/CSV" },
  { key: "users.manage", label: "Gestire operatori" },
  { key: "settings.manage", label: "Gestire impostazioni" },
  { key: "service.view", label: "Accedere al modulo Service" },
  { key: "intervento.viewAll", label: "Vedere tutti gli interventi (non solo i propri)" },
  { key: "intervento.create", label: "Creare interventi di service" },
  { key: "intervento.edit", label: "Modificare / assegnare interventi" },
  { key: "intervento.sign", label: "Firmare rapportini di intervento" },
  { key: "customer.manage", label: "Gestire anagrafica clienti / cantieri" },
  { key: "chat.send", label: "Inviare messaggi nel portale chat" },
  { key: "chat.import", label: "Importare storico chat WhatsApp/Telegram" },
  { key: "knowledge.view", label: "Consultare la Knowledge base" },
  { key: "knowledge.manage", label: "Creare / modificare articoli e documenti Knowledge" },
  { key: "knowledge.ask", label: "Interrogare lo ZATO Brain (assistente AI)" },
  { key: "checklist.manage", label: "Compilare / gestire le check list di cantiere" },
];

export const ALL_ROLES = Object.keys(ROLE_LABEL) as Role[];

export type PermissionMatrix = Record<string, Partial<Record<PermAction, boolean>>>;

/** Matrice permessi di default per ruolo. ADMIN ha sempre tutto. */
export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  // Responsabile cantieri: come l'amministratore (tutti i permessi), ma ruolo
  // modificabile. Unico (con ADMIN) a poter gestire le check list di cantiere.
  RESPONSABILE_CANTIERI: Object.fromEntries(
    [
      "machine.create",
      "machine.edit",
      "machine.intervention",
      "machine.sign",
      "machine.import",
      "users.manage",
      "settings.manage",
      "service.view",
      "intervento.viewAll",
      "intervento.create",
      "intervento.edit",
      "intervento.sign",
      "customer.manage",
      "chat.send",
      "chat.import",
      "knowledge.view",
      "knowledge.manage",
      "knowledge.ask",
      "checklist.manage",
    ].map((k) => [k, true])
  ) as Partial<Record<PermAction, boolean>>,
  ADMIN: {
    "machine.create": true,
    "machine.edit": true,
    "machine.intervention": true,
    "machine.sign": true,
    "machine.import": true,
    "users.manage": true,
    "settings.manage": true,
  },
  // Responsabile produzione: governa il fascicolo e la produzione (creazione,
  // stato/avanzamento, interventi a diario, firme, import massivo) e vede il
  // Service in sola lettura. Non gestisce operatori né impostazioni.
  RESPONSABILE_PRODUZIONE: {
    "machine.create": true,
    "machine.edit": true,
    "machine.intervention": true,
    "machine.sign": true,
    "machine.import": true,
    "users.manage": false,
    "settings.manage": false,
    "service.view": true,
    "intervento.viewAll": true,
    "knowledge.view": true,
    "checklist.manage": true,
  },
  CAPO_OFFICINA: {
    "machine.create": true,
    "machine.edit": true,
    "machine.intervention": true,
    "machine.sign": true,
    "machine.import": true,
    "users.manage": false,
    "settings.manage": false,
    "service.view": true,
    "intervento.viewAll": true,
    "intervento.create": true,
    "intervento.edit": true,
    "intervento.sign": true,
    "customer.manage": true,
    "chat.send": true,
    "chat.import": true,
    "knowledge.view": true,
    "knowledge.manage": true,
    "knowledge.ask": true,
  },
  MONTATORE: { "machine.create": true, "machine.intervention": true, "machine.sign": true, "knowledge.view": true, "knowledge.ask": true },
  CABLATORE: { "machine.create": true, "machine.intervention": true, "machine.sign": true, "knowledge.view": true, "knowledge.ask": true },
  PROGRAMMATORE: { "machine.create": true, "machine.intervention": true, "machine.sign": true, "knowledge.view": true, "knowledge.ask": true },
  COLLAUDATORE: {
    "machine.create": true,
    "machine.intervention": true,
    "machine.sign": true,
    "machine.edit": true,
    "service.view": true,
    "intervento.viewAll": true,
    "intervento.sign": true,
    "knowledge.view": true,
    "knowledge.ask": true,
  },
  // Tecnico di campo: accede al Service ma vede SOLO i propri interventi
  // (intervento.viewAll assente). NON modifica i "Dati intervento"
  // (intervento.edit assente); può solo compilare/firmare i rapportini
  // (intervento.sign). Può creare/aggiornare fascicoli macchina dall'app Fascicolo.
  TECNICO_CAMPO: {
    "machine.create": true,
    "machine.intervention": true,
    "machine.sign": true,
    "service.view": true,
    "intervento.sign": true,
    // chat dell'intervento in Campo (leggere/scrivere, interno e pubblico)
    "chat.send": true,
    "knowledge.view": true,
    "knowledge.ask": true,
  },
  LOGISTICA: { "machine.edit": true, "service.view": true, "knowledge.view": true, "knowledge.ask": true },
};

/** Valuta un permesso. ADMIN può sempre tutto (non si può autobloccare). */
export function can(
  role: Role,
  action: PermAction,
  matrix: PermissionMatrix = DEFAULT_PERMISSIONS
): boolean {
  if (role === "ADMIN") return true;
  return !!matrix[role]?.[action];
}

/** Completa la matrice fornita con i default per ruoli/azioni mancanti. */
export function mergePermissions(stored?: PermissionMatrix | null): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const role of ALL_ROLES) {
    out[role] = {};
    for (const a of PERM_ACTIONS) {
      const fromStored = stored?.[role]?.[a.key];
      out[role][a.key] =
        typeof fromStored === "boolean"
          ? fromStored
          : !!DEFAULT_PERMISSIONS[role]?.[a.key];
    }
  }
  // ADMIN sempre tutto
  for (const a of PERM_ACTIONS) out.ADMIN[a.key] = true;
  return out;
}
