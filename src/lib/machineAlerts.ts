// Due semafori per l'elenco macchine: le schede componenti sono firmate? il
// collaudo è chiuso? Sono le due cose che, se restano indietro, bloccano la
// spedizione — e su 200 fascicoli non si scoprono aprendoli uno a uno.
//
// Modulo puro (client + server): niente import server-only.

import { machineSheetKinds, sheetDef } from "./allestimento";
import { hasCollaudo } from "./plant";

/** Le tre firme in calce al collaudo (card *Firme* della scheda fascicolo). */
export const SIGN_ROLES = ["Montaggio", "Collaudo", "Capo officina"] as const;

/**
 * `na` = non previsto per questa tipologia impianto: la colonna mostra "—",
 * perché un semaforo rosso che non si può mai spegnere è solo rumore.
 */
export type AlertState = "ok" | "pending" | "na";
export type MachineAlert = { state: AlertState; detail: string };

/**
 * Schede di allestimento: verde solo quando **tutte** quelle previste dal
 * fascicolo esistono e sono firmate. Una scheda non ancora aperta conta come
 * da firmare: il dato non c'è, non è che non serve. Quelle escluse alla
 * creazione (un BLUE DEVIL di solo container) non contano: non si compilano.
 */
export function sheetsAlert(
  plantType: string | null,
  signedKinds: Set<string>,
  selected?: string[] | null
): MachineAlert {
  const kinds = machineSheetKinds(plantType, selected);
  if (!kinds.length) return { state: "na", detail: "Nessuna scheda prevista per questa tipologia" };
  const missing = kinds.filter((k) => !signedKinds.has(k));
  if (!missing.length)
    return { state: "ok", detail: `Schede firmate: ${kinds.map((k) => sheetDef(k).code).join(", ")}` };
  return {
    state: "pending",
    detail: `Da firmare: ${missing.map((k) => sheetDef(k).code).join(", ")}`,
  };
}

/**
 * Collaudo: verde quando il verbale è **approvato** e ci sono tutte e tre le
 * firme. Fermarsi alle firme lascerebbe passare per completo un collaudo con
 * la check list ancora da compilare.
 */
export function collaudoAlert(
  plantType: string | null,
  collaudoStatus: string | null,
  signedRoles: Set<string>
): MachineAlert {
  if (!hasCollaudo(plantType))
    return { state: "na", detail: "Collaudo non previsto per questa tipologia" };

  const missing: string[] = [];
  if (collaudoStatus !== "APPROVED")
    missing.push(collaudoStatus === "PENDING_APPROVAL" ? "approvazione check list" : "check list");
  for (const role of SIGN_ROLES) if (!signedRoles.has(role)) missing.push(`firma ${role.toLowerCase()}`);

  if (!missing.length) return { state: "ok", detail: "Check list approvata e tutte le firme raccolte" };
  return { state: "pending", detail: `Manca: ${missing.join(", ")}` };
}
