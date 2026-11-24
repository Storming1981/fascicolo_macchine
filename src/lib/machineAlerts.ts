// Due semafori per l'elenco macchine: le schede componenti sono firmate? il
// collaudo è chiuso? Sono le due cose che, se restano indietro, bloccano la
// spedizione — e su 200 fascicoli non si scoprono aprendoli uno a uno.
//
// Modulo puro (client + server): niente import server-only.

import { machineSheetKinds, sheetDef, SHEET_LABEL, SHAFT_DOCS, sheetKindsFor } from "./allestimento";
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
 * Quali schede comprende il fascicolo: su una flotta di BLUE DEVIL quasi
 * identici serve sapere a colpo d'occhio se quella commessa e' corpo +
 * container o un pezzo solo — oggi lo si scopriva solo aprendo il fascicolo.
 *
 * `na` dove la tipologia ha una scheda sola: non c'e' niente da comporre.
 */
export type SheetsScope = { label: string; partial: boolean; na: boolean };

export function sheetsScope(plantType: string | null, selected?: string[] | null): SheetsScope {
  const all = sheetKindsFor(plantType);
  const kinds = machineSheetKinds(plantType, selected);
  if (all.length < 2) return { label: "", partial: false, na: true };
  return {
    label: kinds.map((k) => SHEET_LABEL[k]).join(" + "),
    partial: kinds.length < all.length,
    na: false,
  };
}

/**
 * Documenti dell'albero (collaudo dimensionale + rilievo): rosso finché
 * mancano. Si chiedono **solo dove c'e' il trituratore** — su un fascicolo di
 * solo container l'albero non esiste, e un semaforo che non si può spegnere è
 * solo rumore.
 */
export function shaftDocsAlert(
  plantType: string | null,
  selected: string[] | null | undefined,
  present: Set<string>
): MachineAlert {
  if (!machineSheetKinds(plantType, selected).includes("TRITURATORE"))
    return { state: "na", detail: "Nessun albero in questo fascicolo" };
  const missing = SHAFT_DOCS.filter((d) => !present.has(d.category));
  if (!missing.length) return { state: "ok", detail: "Collaudo dimensionale e rilievo alberi allegati" };
  return { state: "pending", detail: `Manca: ${missing.map((d) => d.label.toLowerCase()).join(", ")}` };
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
