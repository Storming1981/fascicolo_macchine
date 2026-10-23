// Tipologia impianto e modelli associati.
// Il Job Number è la commessa di vendita. Un BLUE DEVIL si compone di un
// CORPO TRITURATORE (jobBody) e di un CONTAINER (jobContainer): per le macchine
// importate sono numeri di commessa, per le future saranno ordini di produzione.

export const PLANT_TYPES = [
  "BLUE DEVIL",
  "BLUE SHARK",
  "BLUE SORTER",
  "BLUE MARLIN",
  "BLUE STORM",
  "CESOIE",
  "SPACCABINARI",
] as const;

export type PlantType = (typeof PLANT_TYPES)[number];

export const CUSTOM_MODEL = "Altro / Personalizzato";

export const MODELS_BY_PLANT: Record<string, string[]> = {
  "BLUE DEVIL": ["CONTAINER ELETTRICO", "CONTAINER DIESEL", "CORPO TRITURATORE"],
  "BLUE SHARK": ["MULINO 12-10", "MULINO 16-13"],
  "BLUE SORTER": ["LINEA DI SEPARAZIONE SCL-20"],
  "BLUE MARLIN": [],
  "BLUE STORM": [],
  CESOIE: [
    "CAYMAN 06",
    "CAYMAN 10",
    "CAYMAN 20",
    "CAYMAN 30",
    "CAYMAN 40",
    "CAYMAN 50",
    "CAYMAN 70",
    "CAYMAN 90",
  ],
  SPACCABINARI: ["CAYMAN RB20", "CAYMAN RB40"],
};

/** Modelli selezionabili per una tipologia (sempre con opzione personalizzata). */
export function modelsForPlant(plant?: string | null): string[] {
  const base = (plant && MODELS_BY_PLANT[plant]) || [];
  return [...base, CUSTOM_MODEL];
}

/** true se la tipologia ha un doppio job (corpo + container), es. BLUE DEVIL. */
export function hasDualJob(plant?: string | null): boolean {
  return plant === "BLUE DEVIL";
}

/**
 * Job di produzione del fascicolo, per tipologia impianto.
 *
 * Il BLUE DEVIL si compone di due pezzi che hanno ciascuno la propria
 * commessa: **Job Body** (corpo trituratore) e **Job Container**. Mulini,
 * cesoie, spaccabinari e linee di separazione sono una macchina sola: hanno un
 * **Job Pro** (commessa di produzione) e basta — chiedere due job significava
 * lasciarne uno sempre vuoto.
 *
 * Il Job Pro vive nella colonna `jobBody`: i dati esistenti stanno già lì
 * (mulini, cesoia e linee hanno il `jobBody` compilato e il `jobContainer`
 * vuoto), quindi il campo cambia nome e non cambia posto.
 */
export type JobFieldKey = "jobBody" | "jobContainer";
export type JobFieldDef = { key: JobFieldKey; label: string; hint: string; placeholder: string };

const DUAL_JOB_FIELDS: JobFieldDef[] = [
  { key: "jobBody", label: "Job Body", hint: "corpo trituratore", placeholder: "Commessa / ordine corpo" },
  { key: "jobContainer", label: "Job Container", hint: "container", placeholder: "Commessa / ordine container" },
];
const SINGLE_JOB_FIELDS: JobFieldDef[] = [
  { key: "jobBody", label: "Job Pro", hint: "commessa produzione", placeholder: "Commessa di produzione" },
];

export function jobFields(plant?: string | null): JobFieldDef[] {
  return hasDualJob(plant) ? DUAL_JOB_FIELDS : SINGLE_JOB_FIELDS;
}

/** Ruolo dell'ordine di produzione legato al job di produzione principale. */
export function mainOrderRole(plant?: string | null): string {
  return hasDualJob(plant) ? "Corpo" : "Produzione";
}

/**
 * Tipologie **senza** check list di collaudo. La linea di separazione non si
 * collauda come una macchina singola: si verifica in campo a linea montata,
 * quindi un verbale di collaudo in fascicolo non lo compilerebbe nessuno e
 * terrebbe il fascicolo incompleto per sempre.
 */
const NO_COLLAUDO: string[] = ["BLUE SORTER"];

export function hasCollaudo(plant?: string | null): boolean {
  return !NO_COLLAUDO.includes((plant ?? "").trim().toUpperCase());
}

/** Il kit opzionale "tirante giunto" esiste solo sui BLUE DEVIL. */
export function hasTiranteGiunto(plant?: string | null): boolean {
  return plant === "BLUE DEVIL";
}

export const PLANT_COLORS: Record<string, string> = {
  "BLUE DEVIL": "#0f3b66",
  "BLUE SHARK": "#1d6fb8",
  "BLUE SORTER": "#0ea5a3",
  "BLUE MARLIN": "#6366f1",
  "BLUE STORM": "#8b5cf6",
  CESOIE: "#f59e0b",
  SPACCABINARI: "#71717a",
};
