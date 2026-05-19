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
    id: "hyd_pumps",
    label: "Pompe idrauliche",
    en: "HIDRAULIC PUMPS",
    icon: "pump",
    slots: ["Pompa #1", "Pompa #2"],
    extra: [{ key: "valves", label: "Valvole (bar)" }],
    excel: { brandCol: "Q", serialCols: ["R", "S"], extraCols: { valves: "T+U" } },
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

export function groupById(id: string) {
  return COMPONENT_GROUPS.find((g) => g.id === id);
}
