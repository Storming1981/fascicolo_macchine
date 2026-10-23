// Gruppi componenti tracciati per ogni macchina.
// Struttura allineata al file Excel "FILE MATRICOLE" (intestazioni a 2 righe).

export type ExtraField = { key: string; label: string };

export type ComponentGroup = {
  id: string;
  label: string; // IT
  en: string; // intestazione Excel
  icon: string;
  slots: string[];
  extra?: ExtraField[];
  /**
   * Il componente porta, accanto alla matricola, anche un lotto o una data di
   * lotto (es. blocchi motore MAGNUM: "MM104353" e sotto "09/26"). Dove c'è,
   * lo slot ha un secondo campo e l'OCR lo legge dalla stessa foto.
   */
  lot?: { label: string };
  /**
   * Gli slot del gruppo tengono **solo foto** (la carpenteria di una linea):
   * non c'è un numero da trascrivere, quindi non entrano nel conteggio delle
   * matricole — altrimenti il fascicolo non arriverebbe mai al 100%.
   */
  photoOnly?: boolean;
  /** Lettere colonna Excel (R3+ = dati) per il parser di import */
  excel: { brandCol?: string; serialCols: string[]; extraCols?: Record<string, string> };
};

export const COMPONENT_GROUPS: ComponentGroup[] = [
  {
    id: "gearboxes",
    label: "Riduttori",
    en: "GEAR BOXES",
    icon: "gear",
    slots: ["Riduttore #1", "Riduttore #2", "Riduttore #3", "Riduttore #4"],
    excel: { brandCol: "G", serialCols: ["H", "I", "J", "K"] },
  },
  {
    id: "hyd_motors",
    label: "Motori idraulici",
    en: "HIDRAULIC MOTORS",
    icon: "rotor",
    slots: ["Motore #1", "Motore #2", "Motore #3", "Motore #4"],
    excel: { brandCol: "L", serialCols: ["M", "N", "O", "P"] },
  },
  {
    // Non presente nel file MATRICOLE: nasce con la scheda allestimento trituratore M5.16.
    id: "motor_blocks",
    label: "Blocchi motore",
    en: "MOTOR BLOCKS",
    icon: "rotor",
    slots: ["Blocco #1", "Blocco #2", "Blocco #3", "Blocco #4"],
    lot: { label: "Data lotto" },
    excel: { serialCols: [] },
  },
  {
    id: "stand",
    label: "Cavalletto e tramoggia",
    en: "STAND & HOPPER",
    icon: "box",
    slots: ["Cavalletto"],
    excel: { serialCols: [] },
  },
  {
    // La targhetta CE dell'impianto si fotografa sempre in officina: il numero
    // da tenere e' il SERIAL NO. stampato sulla targhetta.
    id: "plate",
    label: "Targhetta CE",
    en: "CE PLATE",
    icon: "qr",
    slots: ["Targhetta"],
    excel: { serialCols: [] },
  },
  {
    // Non presente nel file MATRICOLE: nasce con la scheda M5.16 (lotto albero
    // letto dalla foto come le matricole dei riduttori).
    id: "shaft",
    label: "Albero",
    en: "SHAFT",
    icon: "rotor",
    slots: ["Albero #1", "Albero #2"], // gli alberi lavorati da DGS sono sempre due
    excel: { serialCols: [] },
  },
  {
    id: "hyd_pumps",
    label: "Pompe idrauliche",
    en: "HIDRAULIC PUMPS",
    icon: "pump",
    slots: ["Pompa #1", "Pompa #2"],
    extra: [{ key: "valves", label: "Valvole (bar)" }],
    excel: { brandCol: "Q", serialCols: ["R", "S"], extraCols: { valves: "T+U" } },
  },
  {
    // Blocchi pompe LINDE / MAGNUM: due per container.
    id: "pump_blocks",
    label: "Blocchi pompe",
    en: "PUMP BLOCKS",
    icon: "pump",
    slots: ["Blocco #1", "Blocco #2"],
    excel: { serialCols: [] },
  },
  {
    id: "fill_pump",
    label: "Pompa di riempimento",
    en: "FILLING PUMP",
    icon: "drop",
    slots: ["Motore", "Pompa"],
    // Motore e pompa sono di due costruttori diversi (BROOK CROMPTON + VALVOIL)
    extra: [{ key: "pumpBrand", label: "Marca pompa" }],
    excel: { serialCols: [] },
  },
  {
    id: "speed_valve",
    label: "Valvola regolazione velocità",
    en: "SPEED CONTROL VALVE",
    icon: "oil",
    slots: ["Valvola"],
    excel: { serialCols: [] },
  },
  {
    id: "boost_pumps",
    label: "Pompe di sovralimentazione",
    en: "BOOST PUMPS",
    icon: "boost",
    slots: ["Boost #1", "Boost #2", "Boost #3", "Boost #4"],
    excel: { brandCol: "V", serialCols: ["W", "X", "Y", "Z"] },
  },
  {
    id: "electric_motor",
    label: "Motore elettrico",
    en: "ELECTRIC MOTOR",
    icon: "bolt",
    slots: ["Motore #1", "Motore #2"],
    excel: { brandCol: "AA", serialCols: ["AB", "AC"] },
  },
  {
    id: "diesel",
    label: "Motore diesel",
    en: "DIESEL ENGINE",
    icon: "engine",
    slots: ["Motore"],
    excel: { brandCol: "AD", serialCols: ["AE"] },
  },
  {
    id: "container",
    label: "Container",
    en: "CONTAINER",
    icon: "box",
    slots: ["Container"],
    excel: { brandCol: "AF", serialCols: ["AG"] },
  },
  {
    id: "cooling",
    label: "Gruppo raffreddamento",
    en: "COOLING UNIT",
    icon: "snow",
    slots: ["Gruppo"],
    excel: { brandCol: "AH", serialCols: ["AJ"] },
  },
  {
    id: "hyd_unit",
    label: "Centralina idraulica",
    en: "HIDRAULIC UNIT",
    icon: "oil",
    slots: ["Centralina"],
    excel: { brandCol: "AK", serialCols: ["AL"] },
  },
  {
    id: "grease",
    label: "Pompa grasso",
    en: "GREASE PUMP",
    icon: "drop",
    slots: ["Pompa"],
    excel: { brandCol: "AM", serialCols: ["AN"] },
  },
  {
    id: "cabinet",
    label: "Quadro elettrico",
    en: "ELECTRIC CABINET",
    icon: "panel",
    slots: ["Quadro"],
    excel: { brandCol: "AO", serialCols: ["AP"] },
  },
  {
    id: "hmi",
    label: "HMI",
    en: "HMI",
    icon: "screen",
    slots: ["Pannello"],
    excel: { brandCol: "AQ", serialCols: ["AR"] },
  },
  {
    id: "dissipators",
    label: "Dissipatori di calore",
    en: "HEAT DISSIPATORS",
    icon: "fan",
    slots: ["Dissipatore #1", "Dissipatore #2"],
    excel: { brandCol: "AS", serialCols: ["AT", "AU"] },
  },
  {
    id: "heater",
    label: "Scaldiglia",
    en: "HEATER",
    icon: "bolt",
    slots: ["Scaldiglia"],
    excel: { serialCols: [] },
  },
  {
    id: "radiator_block",
    label: "Blocco radiatori",
    en: "RADIATOR BLOCK",
    icon: "fan",
    slots: ["Blocco"],
    excel: { serialCols: [] },
  },
  // ── Linea di separazione (BLUE SORTER) ──────────────────────────────
  {
    id: "frame",
    label: "Carpenteria",
    en: "FRAME",
    icon: "box",
    // Nessuna matricola: lo slot serve solo a tenere le foto della carpenteria
    slots: ["Carpenteria"],
    photoOnly: true,
    excel: { serialCols: [] },
  },
  // Piano vibrante, tamburo magnetico, overbelt ed ECS sono **blocchi
  // ripetibili** (groupId `vibro-1`, `overbelt-2`, …): queste voci restano come
  // catalogo — etichetta e campi extra — e come riferimento dei fascicoli
  // compilati con la prima versione della scheda.
  {
    id: "vibro",
    label: "Piano vibrante",
    en: "VIBRATING FEEDER",
    icon: "rotor",
    slots: ["Piano vibrante"],
    extra: [
      { key: "larghezza", label: "Larghezza (mm)" },
      { key: "lunghezza", label: "Lunghezza (mm)" },
    ],
    excel: { serialCols: [] },
  },
  {
    id: "magnet",
    label: "Tamburo magnetico",
    en: "MAGNETIC DRUM",
    icon: "rotor",
    slots: ["Tamburo"],
    extra: [
      { key: "larghezza", label: "Larghezza (mm)" },
      { key: "lunghezza", label: "Lunghezza (mm)" },
    ],
    excel: { serialCols: [] },
  },
  {
    id: "overbelt",
    label: "Overbelt",
    en: "OVERBELT",
    icon: "rotor",
    slots: ["Overbelt"],
    extra: [
      { key: "larghezza", label: "Larghezza (mm)" },
      { key: "lunghezza", label: "Lunghezza (mm)" },
    ],
    excel: { serialCols: [] },
  },
  {
    id: "ecs",
    label: "ECS",
    en: "EDDY CURRENT SEPARATOR",
    icon: "bolt",
    slots: ["ECS"],
    extra: [
      { key: "modello", label: "Modello" },
      { key: "larghezza", label: "Larghezza (mm)" },
      { key: "lunghezza", label: "Lunghezza (mm)" },
    ],
    excel: { serialCols: [] },
  },
  {
    id: "remote",
    label: "Radiocomando",
    en: "REMOTE CONTROLLER",
    icon: "remote",
    slots: ["TX", "RX", "TX di scorta", "Global"],
    excel: { brandCol: "AV", serialCols: ["AW", "AX", "AY", "AZ"] },
  },
  {
    id: "blades",
    label: "Lame",
    en: "BLADES",
    icon: "blade",
    slots: ["Set lame"],
    extra: [
      { key: "type", label: "Tipo" },
      { key: "lot", label: "Lotto" },
    ],
    excel: { brandCol: "BB", serialCols: [], extraCols: { type: "BC", lot: "BD" } },
  },
];

/** Etichetta del campo lotto di un gruppo, se quel componente ne ha uno. */
export function lotLabel(groupId: string | null | undefined): string | undefined {
  return groupId ? COMPONENT_GROUPS.find((g) => g.id === groupId)?.lot?.label : undefined;
}

export function groupById(id: string) {
  return COMPONENT_GROUPS.find((g) => g.id === id);
}
