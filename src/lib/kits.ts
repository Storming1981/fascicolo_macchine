// Spunte di dotazione della macchina: caratteristiche che non sono una
// matricola né una specifica di scheda, ma che devono restare consultabili
// sull'intera flotta (colonna nell'elenco macchine).
//
// Stanno su `Machine` e si spuntano dalla riga del componente che le riguarda
// nella scheda di allestimento, non da un riquadro a parte: chi monta il
// componente è chi sa se il kit c'è.
//
// Modulo puro (client + server): niente import server-only.

export type KitFlag = "tiranteGiunto" | "filtroMaggiorato";

export type KitDef = {
  key: KitFlag;
  /** Etichetta della spunta nella scheda. */
  label: string;
  hint: string;
  /** Intestazione della colonna nell'elenco macchine. */
  column: string;
  /** Titolo dell'evento a diario (montato / non montato). */
  diary: [string, string];
  plantTypes: string[];
  /**
   * Scheda di allestimento sulla cui riga si spunta il kit. Un fascicolo di
   * mezzo impianto (solo corpo, solo container) quella scheda può non
   * comprenderla: lì il kit non esiste proprio, e chiederlo — o mostrarne la
   * casella in elenco — vorrebbe dire raccogliere un dato su un pezzo che non
   * si spedisce.
   */
  sheet: "TRITURATORE" | "CONTAINER";
};

export const KITS: KitDef[] = [
  {
    key: "tiranteGiunto",
    label: "Tirante giunto",
    hint: "Spunta se questa macchina monta il kit tirante giunto.",
    column: "Tirante giunto",
    diary: ["Kit tirante giunto: montato", "Kit tirante giunto: non montato"],
    plantTypes: ["BLUE DEVIL"],
    sheet: "TRITURATORE", // M5.16, riga Giunti sicurezza
  },
  {
    key: "filtroMaggiorato",
    label: "Centrale con filtro maggiorato",
    hint: "Spunta se la centrale idraulica monta il filtro maggiorato.",
    column: "Filtro maggiorato",
    diary: ["Centrale idraulica: filtro maggiorato", "Centrale idraulica: filtro standard"],
    plantTypes: ["BLUE DEVIL"],
    sheet: "CONTAINER", // M5.17, riga Centrale Idraulica
  },
];

export const KIT_KEYS = KITS.map((k) => k.key);

export function kitDef(key: string): KitDef | undefined {
  return KITS.find((k) => k.key === key);
}

export function isKitFlag(v: unknown): v is KitFlag {
  return typeof v === "string" && (KIT_KEYS as string[]).includes(v);
}

/**
 * Il kit è previsto su questo fascicolo?
 *
 * `sheetKinds` sono le schede che il fascicolo comprende davvero
 * (`machineSheetKinds`, non la colonna grezza): passandole, un kit la cui
 * scheda non c'è risponde no. Senza, vale la sola regola di tipologia — utile
 * dove le schede non si sanno, ma chi mostra una casella all'operatore le sa.
 */
export function hasKit(key: string, plantType?: string | null, sheetKinds?: string[] | null): boolean {
  const d = kitDef(key);
  if (!d || !plantType || !d.plantTypes.includes(plantType)) return false;
  return !sheetKinds || sheetKinds.includes(d.sheet);
}

/** Kit da mostrare come colonna per un fascicolo. */
export function kitsFor(plantType?: string | null, sheetKinds?: string[] | null): KitDef[] {
  return KITS.filter((k) => hasKit(k.key, plantType, sheetKinds));
}
