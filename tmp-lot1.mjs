import { readFileSync, writeFileSync } from "fs";
const edit = (file, pairs) => {
  let src = readFileSync(file, "utf8");
  const crlf = src.includes("\r\n");
  for (const [from, to] of pairs) {
    const a = crlf ? from.replaceAll("\n", "\r\n") : from;
    const b = crlf ? to.replaceAll("\n", "\r\n") : to;
    const n = src.split(a).length - 1;
    if (n !== 1) { console.error(`[${file}] ${n} -> ${from.slice(0, 60).replace(/\n/g, "\n")}`); process.exit(1); }
    src = src.replace(a, b);
  }
  writeFileSync(file, src);
  console.log("ok", file);
};

edit("prisma/schema.prisma", [[
`  label       String
  serial      String?
  note        String?`,
`  label       String
  serial      String?
  lot         String? // data o numero di lotto stampato accanto alla matricola (es. 09/26)
  note        String?`
]]);

// gruppi che portano anche un lotto sulla targhetta
edit("src/lib/components.ts", [
  [
`  extra?: ExtraField[];`,
`  extra?: ExtraField[];
  /**
   * Il componente porta, accanto alla matricola, anche un lotto o una data di
   * lotto (es. blocchi motore MAGNUM: "MM104353" e sotto "09/26"). Dove c'è,
   * lo slot ha un secondo campo e l'OCR lo legge dalla stessa foto.
   */
  lot?: { label: string };`
  ],
  [
`    id: "motor_blocks",
    label: "Blocchi motore",
    en: "MOTOR BLOCKS",
    icon: "rotor",
    slots: ["Blocco #1", "Blocco #2", "Blocco #3", "Blocco #4"],`,
`    id: "motor_blocks",
    label: "Blocchi motore",
    en: "MOTOR BLOCKS",
    icon: "rotor",
    slots: ["Blocco #1", "Blocco #2", "Blocco #3", "Blocco #4"],
    lot: { label: "Data lotto" },`
  ],
  [
`export function groupById(id: string) {`,
`/** Etichetta del campo lotto di un gruppo, se quel componente ne ha uno. */
export function lotLabel(groupId: string | null | undefined): string | undefined {
  return groupId ? COMPONENT_GROUPS.find((g) => g.id === groupId)?.lot?.label : undefined;
}

export function groupById(id: string) {`
  ],
]);

// OCR: legge anche il lotto
edit("src/lib/serialOcr.ts", [
  [
`  /** Etichetta stampata accanto alla matricola (es. "NR.MATRICOLA - REGISTRATION NR"). */
  label: string;`,
`  /** Etichetta stampata accanto alla matricola (es. "NR.MATRICOLA - REGISTRATION NR"). */
  label: string;
  /** Lotto o data di lotto letti sulla stessa targhetta (es. "09/26"), "" se assenti. */
  lot: string;`
  ],
  [
`Elenca in candidates tutti i codici che riesci a leggere, ciascuno con la sua etichetta.\`;`,
`Oltre alla matricola, cerca il LOTTO o la DATA DI LOTTO: sulle targhette punzonate sta spesso sotto la matricola nel formato mm/aa o mm/aaaa (es. "09/26"), oppure accanto a etichette come LOTTO, LOT, BATCH, DATE, DATA. È un dato diverso dalla matricola: va in lot, non in serial, e se non c'è lot resta vuoto.

Elenca in candidates tutti i codici che riesci a leggere, ciascuno con la sua etichetta.\`;`
  ],
  [
`  required: ["serial", "label", "confidence", "candidates"],
  properties: {
    serial: { type: "string", description: "Matricola esatta, stringa vuota se non individuata" },
    label: { type: "string", description: "Etichetta stampata accanto alla matricola" },`,
`  required: ["serial", "label", "lot", "confidence", "candidates"],
  properties: {
    serial: { type: "string", description: "Matricola esatta, stringa vuota se non individuata" },
    label: { type: "string", description: "Etichetta stampata accanto alla matricola" },
    lot: { type: "string", description: "Lotto o data di lotto (es. 09/26), stringa vuota se assente" },`
  ],
  [
`  out.serial = out.serial.replace(/\s+/g, "").trim();
  return out;`,
`  out.serial = out.serial.replace(/\s+/g, "").trim();
  out.lot = (out.lot ?? "").replace(/\s+/g, "").trim();
  return out;`
  ],
]);
