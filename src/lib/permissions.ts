import type { Role } from "@prisma/client";
import { ROLE_LABEL } from "./domain";

export type PermAction =
  | "machine.create"
  | "machine.edit"
  | "machine.intervention"
  | "machine.sign"
  | "machine.import"
  | "users.manage"
  | "settings.manage";

export const PERM_ACTIONS: { key: PermAction; label: string }[] = [
  { key: "machine.create", label: "Creare fascicoli macchina" },
  { key: "machine.edit", label: "Modificare stato / avanzamento" },
  { key: "machine.intervention", label: "Registrare interventi nel diario" },
  { key: "machine.sign", label: "Apporre firme (collaudo/intervento)" },
  { key: "machine.import", label: "Import massivo Excel/CSV" },
  { key: "users.manage", label: "Gestire operatori" },
  { key: "settings.manage", label: "Gestire impostazioni" },
];

export const ALL_ROLES = Object.keys(ROLE_LABEL) as Role[];

export type PermissionMatrix = Record<string, Partial<Record<PermAction, boolean>>>;

/** Matrice permessi di default per ruolo. ADMIN ha sempre tutto. */
export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  ADMIN: {
    "machine.create": true,
    "machine.edit": true,
    "machine.intervention": true,
    "machine.sign": true,
    "machine.import": true,
    "users.manage": true,
    "settings.manage": true,
  },
  CAPO_OFFICINA: {
    "machine.create": true,
    "machine.edit": true,
    "machine.intervention": true,
    "machine.sign": true,
    "machine.import": true,
    "users.manage": false,
    "settings.manage": false,
  },
  MONTATORE: { "machine.intervention": true, "machine.sign": true },
  CABLATORE: { "machine.intervention": true, "machine.sign": true },
  PROGRAMMATORE: { "machine.intervention": true, "machine.sign": true },
  COLLAUDATORE: { "machine.intervention": true, "machine.sign": true, "machine.edit": true },
  TECNICO_CAMPO: { "machine.intervention": true, "machine.sign": true, "machine.edit": true },
  LOGISTICA: { "machine.edit": true },
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
