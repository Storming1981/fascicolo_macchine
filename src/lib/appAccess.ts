import type { Role } from "@prisma/client";
import { ALL_ROLES, can, type PermissionMatrix } from "./permissions";

/**
 * Modello di accesso alle "app" della piattaforma.
 *
 * - Guscio **desktop**: applicazione completa con sidebar (responsabili).
 * - Guscio **campo**: app mobile/tablet senza sidebar, pensata per gli operativi
 *   (compilazione interventi in cantiere, fascicolo macchina in produzione).
 *
 * Il profilo è per RUOLO (default configurabile in Impostazioni) con override
 * per singolo utente (User.appAccess).
 *
 * Regola d'atterraggio (device-aware):
 *  - profilo "field"   → sempre e solo Campo, su qualunque dispositivo.
 *  - profilo "desktop" → Desktop su PC; su tablet/telefono passa a Campo
 *    (rilevato da user-agent), con possibilità di forzare lo switch (cookie).
 */
export type AppProfile = "desktop" | "field";
export type CampoApp = "interventi" | "fascicolo";

export type AppAccessMatrix = Record<string, AppProfile>;

/** Default per ruolo: solo ADMIN e Capo officina partono desktop. */
export const DEFAULT_APP_ACCESS: AppAccessMatrix = {
  ADMIN: "desktop",
  RESPONSABILE_CANTIERI: "desktop",
  CAPO_OFFICINA: "desktop",
  MONTATORE: "field",
  CABLATORE: "field",
  PROGRAMMATORE: "field",
  COLLAUDATORE: "field",
  TECNICO_CAMPO: "field",
  LOGISTICA: "field",
};

export function mergeAppAccess(stored?: AppAccessMatrix | null): AppAccessMatrix {
  const out: AppAccessMatrix = {};
  for (const role of ALL_ROLES) {
    const v = stored?.[role];
    out[role] = v === "desktop" || v === "field" ? v : DEFAULT_APP_ACCESS[role] ?? "field";
  }
  out.ADMIN = "desktop"; // l'admin ha sempre il desktop
  return out;
}

export type ResolvedAccess = {
  profile: AppProfile;
  desktop: boolean; // può usare il guscio desktop
  campoApps: CampoApp[]; // app campo a cui ha diritto
};

/**
 * Risolve l'accesso di un utente: profilo (override utente → ruolo → default) e
 * le app campo disponibili in base ai permessi.
 */
export function resolveAccess(
  user: { role: Role; appAccess?: string | null },
  appMatrix: AppAccessMatrix,
  perms: PermissionMatrix
): ResolvedAccess {
  const override =
    user.appAccess === "desktop" || user.appAccess === "field" ? (user.appAccess as AppProfile) : null;
  const profile: AppProfile = override ?? appMatrix[user.role] ?? "field";

  const campoApps: CampoApp[] = [];
  if (can(user.role, "service.view", perms)) campoApps.push("interventi");
  if (can(user.role, "machine.intervention", perms) || can(user.role, "machine.edit", perms))
    campoApps.push("fascicolo");

  // Nessuna app campo disponibile → forza il desktop (nessun blocco).
  const desktop = profile === "desktop" || user.role === "ADMIN" || campoApps.length === 0;
  return { profile, desktop, campoApps };
}

const MOBILE_RE = /Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;
const TABLET_RE = /iPad|Tablet|Nexus 7|Nexus 10|SM-T|KFAPWI|PlayBook|Silk/i;

/** Rilevamento (best-effort) dispositivo mobile/tablet dallo user-agent. */
export function isMobileUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  if (TABLET_RE.test(ua)) return true;
  if (MOBILE_RE.test(ua)) return true;
  // iPadOS recente si maschera da Mac: euristica su "Macintosh" + touch non è
  // disponibile lato server, quindi si affida allo switch manuale.
  return false;
}
