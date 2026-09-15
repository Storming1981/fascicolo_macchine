// Schede di allestimento BLUE DEVIL: M5.16 Trituratore e M5.17 Container.
//
// Le righe che hanno una matricola non duplicano i dati: puntano ai gruppi
// componente già a sistema (COMPONENT_GROUPS). La "specifica" di quelle righe è
// la marca del gruppo (o un suo campo extra, es. tipo/lotto lame), le matricole
// sono gli slot del gruppo. Le altre voci (colori, fornitori, controlli) stanno
// nella scheda (`AllestimentoSheet.values`).
//
// Modulo condiviso client/server: niente import server-only.

export type SheetKind = "TRITURATORE" | "CONTAINER";
export const SHEET_KINDS: SheetKind[] = ["TRITURATORE", "CONTAINER"];

export type SheetInput = "text" | "yesno" | "yesnona" | "select";
export type SheetCtx = { diesel: boolean };

export type SheetRow = {
  key: string;
  label: string;
  input?: SheetInput; // default "text"
  options?: string[]; // per "select"
  suggest?: string[]; // suggerimenti (datalist) per "text"
  /** La specifica si legge/scrive sul gruppo componente invece che sulla scheda. */
  bind?: { group: string; field: "brand" } | { group: string; field: "extra"; extraKey: string };
  /** Gruppo componente i cui slot forniscono le matricole della riga. */
  serials?: string;
  /** Matricola singola salvata nella scheda (es. targhetta CE). */
  serialField?: boolean;
  /** Specifica su tutta la larghezza (specifica + matricola), come nel modulo cartaceo. */
  wide?: boolean;
  when?: (ctx: SheetCtx) => boolean;
};

export type SheetSection = { key: string; title: string; subtitle?: string; rows: SheetRow[] };

export type SheetDef = {
  kind: SheetKind;
  code: string;
  title: string;
  rev: string;
  typeLabel: string;
  typeOptions?: string[];
  sections: SheetSection[];
};

export type SheetValue = { spec?: string; serial?: string; note?: string };
export type SheetValues = Record<string, SheetValue>;
export type SheetHeader = { tipo?: string; collaudatoDa?: string };

export const YES_NO = ["Sì", "No"];
export const YES_NO_NA = ["Sì", "No", "N.a."];
const COLORS = ["BLUE OPACO 5017", "BIANCO OPACO 9003"];

const isElectric = (c: SheetCtx) => !c.diesel;
const isDiesel = (c: SheetCtx) => c.diesel;

export const SHEET_TRITURATORE: SheetDef = {
  kind: "TRITURATORE",
  code: "M5.16",
  title: "SCHEDA ALLESTIMENTO TRITURATORE",
  rev: "rev.00 Aprile 2023",
  typeLabel: "TIPO GF",
  sections: [
    {
      key: "cavalletto",
      title: "ALLESTIMENTO CAVALLETTO TRAMOGGIA",
      rows: [
        { key: "costruttore_cavalletto", label: "Costruttore cavalletto e tramoggia", suggest: ["STAM"] },
        { key: "colore_cavalletto", label: "Colore cavalletto", suggest: COLORS },
        { key: "colore_tramoggia", label: "Colore tramoggia", suggest: COLORS },
        { key: "verniciatura_cavalletto", label: "Verniciatura", suggest: ["ZATO", "ZAMA"] },
        { key: "targhetta_ce_impianto", label: "Targhetta CE impianto", suggest: ["ZATO"] },
        { key: "speciali_cavalletto", label: "Specifiche speciali" },
      ],
    },
    {
      key: "tubi",
      title: "ALLESTIMENTO LINEA TUBI",
      rows: [
        { key: "layout", label: "Nr. Layout installazione" },
        { key: "fornitore_tubi", label: "Fornitore tubi", suggest: ["FLUIDMEC"] },
        { key: "fornitore_tubi_rigidi", label: "Fornitore tubi rigidi", suggest: ["EFFEGI"] },
        { key: "lunghezza_linea", label: "Lunghezza linea ferro", suggest: ["STD"] },
        { key: "kit_ruotato", label: "Kit ruotato", input: "yesno" },
        { key: "speciali_tubi", label: "Specifiche speciali" },
      ],
    },
    {
      key: "corpo",
      title: "ALLESTIMENTO CORPO MACCHINA",
      rows: [
        { key: "targhetta_ce", label: "Targhetta CE Macchina", suggest: ["ZATO"], serialField: true },
        { key: "riduttori", label: "Costruttore riduttori", bind: { group: "gearboxes", field: "brand" }, serials: "gearboxes", suggest: ["DINAMIC OIL"] },
        { key: "motori_idraulici", label: "Motori idraulici", bind: { group: "hyd_motors", field: "brand" }, serials: "hyd_motors", suggest: ["LINDE"] },
        { key: "blocchi_motore", label: "Blocchi motore", bind: { group: "motor_blocks", field: "brand" }, serials: "motor_blocks", suggest: ["MAGNUM"] },
        { key: "giunti_sicurezza", label: "Giunti sicurezza", input: "yesno" },
        { key: "lame", label: "Lame", bind: { group: "blades", field: "extra", extraKey: "type" }, suggest: ["PLATINUM"] },
        { key: "costruttore_lame", label: "Costruttori lame", bind: { group: "blades", field: "brand" }, suggest: ["CO.DI.TRA"] },
        { key: "lotto_lame", label: "Lotto lame", bind: { group: "blades", field: "extra", extraKey: "lot" } },
        { key: "lav_portalame", label: "Lav portalame - distanziali - alberi", suggest: ["DGS"] },
        { key: "montaggio_albero", label: "Montaggio albero", suggest: ["DGS"] },
        { key: "lotto_albero", label: "Lotto albero" },
        { key: "lav_cassa", label: "Lav cassa", suggest: ["OFFICINE FN"] },
        { key: "corazzine", label: "Corazzine inferiori", input: "yesno" },
        { key: "materiale_ghiere", label: "Materiale ghiere", suggest: ["C45"] },
        { key: "ghiera_portalama", label: "Tipo ghiera lato libero con portalama", suggest: ["CILINDRICA DIAMETRO EST. PICCOLO"], wide: true },
        { key: "ghiera_distanziale", label: "Tipo ghiera lato libero con distanziale", suggest: ["CILINDRICA DIAMETRO EST. PICCOLO"], wide: true },
        { key: "colore_corpo", label: "Colore corpo macchina", suggest: COLORS },
        { key: "verniciatura_corpo", label: "Verniciatura", suggest: ["ZATO", "ZAMA"] },
        { key: "spedizione_corpo", label: "Tipo spedizione corpo", input: "select", options: ["MONTATO", "SMONTATO"] },
      ],
    },
    {
      key: "controlli",
      title: "CONTROLLI FINALI",
      rows: [
        { key: "ctrl_visivo", label: "Controllo visivo generale macchina", input: "yesnona" },
        { key: "ctrl_sfregamenti", label: "Controllo sfregamenti anomali su settori pulitori", input: "yesnona" },
        { key: "ctrl_riduttori", label: "Controllo montaggio riduttori (sfiati, tappi)", input: "yesnona" },
        { key: "ctrl_oring", label: "Controllo guarnizione O-Ring tra motore e riduttore", input: "yesnona" },
        { key: "ctrl_lame", label: "Controllo spazio tra lama e lama (0,5 mm)", input: "yesnona" },
        { key: "ctrl_verniciatura", label: "Controllo verniciatura", input: "yesnona" },
        { key: "ctrl_adesivi", label: "Controllo applicazione adesivi e pittogrammi", input: "yesnona" },
        { key: "speciali_controlli", label: "Specifiche speciali" },
      ],
    },
  ],
};

export const SHEET_CONTAINER: SheetDef = {
  kind: "CONTAINER",
  code: "M5.17",
  title: "SCHEDA ALLESTIMENTO CONTAINER",
  rev: "Rev. 00 maggio 22",
  typeLabel: "TIPO GF",
  typeOptions: ["CONTAINER E", "CONTAINER D"],
  sections: [
    {
      key: "container",
      title: "ALLESTIMENTO CONTAINER",
      rows: [
        { key: "nr_motori", label: "Nr. Motori Elettrici", when: isElectric },
        { key: "potenza_motori", label: "Potenza motori (kW)" },
        { key: "tensione_motori", label: "Tensione motore (V)", suggest: ["400", "690"], when: isElectric },
        { key: "frequenza_motori", label: "Frequenza (Hz)", suggest: ["50", "60"], when: isElectric },
        { key: "marca_motori", label: "Marca motori", bind: { group: "electric_motor", field: "brand" }, serials: "electric_motor", suggest: ["SIMOTOP"], when: isElectric },
        { key: "motore_diesel", label: "Motore diesel", bind: { group: "diesel", field: "brand" }, serials: "diesel", when: isDiesel },
        { key: "costruttore_container", label: "Costruttori Container", bind: { group: "container", field: "brand" }, serials: "container", suggest: ["ECOFER"] },
        { key: "coibentazione", label: "Coibentazione Container", input: "yesno" },
        { key: "condizionatore", label: "Costruttore Condizionatore", bind: { group: "cooling", field: "brand" }, serials: "cooling" },
        { key: "tensione_condizionatore", label: "Tensione Condizionatore (V)" },
        { key: "frequenza_condizionatore", label: "Frequenza Condizionatore (Hz)", suggest: ["50", "60"] },
        { key: "centrale_idraulica", label: "Centrale Idraulica", bind: { group: "hyd_unit", field: "brand" }, serials: "hyd_unit", suggest: ["MAGNUM"] },
        { key: "pompe", label: "Pompe idrauliche (Pompa 1 / Pompa 2)", bind: { group: "hyd_pumps", field: "brand" }, serials: "hyd_pumps", suggest: ["LINDE"] },
        { key: "valvola_max", label: "Valvola Max", bind: { group: "hyd_pumps", field: "extra", extraKey: "valves" } },
        { key: "taglio_pressione", label: "Valore taglio di pressione" },
        { key: "pompe_sovralimentazione", label: "Pompe sovralimentaz. e raffreddamento", bind: { group: "boost_pumps", field: "brand" }, serials: "boost_pumps", suggest: ["B & C"] },
        { key: "pompa_grasso", label: "Pompa Grasso", bind: { group: "grease", field: "brand" }, serials: "grease", suggest: ["CIAPONI"] },
        { key: "nr_radiatori", label: "Nr. Radiatori" },
        { key: "radiatori", label: "Radiatori", bind: { group: "dissipators", field: "brand" }, serials: "dissipators", suggest: ["SESINO"] },
        { key: "installazione_radiatori", label: "Tipo installazione Radiatori", suggest: ["A TETTO", "LATERALE"] },
        { key: "radiatore_marino", label: "Radiatore modello marino", input: "yesno" },
        { key: "colore_container", label: "Colore container", suggest: COLORS },
        { key: "speciali_container", label: "Specifiche speciali" },
      ],
    },
    {
      key: "elettrico",
      title: "QUADRO ELETTRICO E COMANDI",
      subtitle: "Voci a sistema, non presenti sul modulo rev.00",
      rows: [
        { key: "quadro_elettrico", label: "Quadro elettrico", bind: { group: "cabinet", field: "brand" }, serials: "cabinet" },
        { key: "hmi", label: "HMI", bind: { group: "hmi", field: "brand" }, serials: "hmi" },
      ],
    },
    {
      key: "spedizione",
      title: "CONTROLLI PRIMA DELLA SPEDIZIONE",
      rows: [
        { key: "ctrl_batterie", label: "Scollegare batterie motore e plc", input: "yesnona" },
        { key: "ctrl_estintore", label: "Estintore e staffa di sostegno", input: "yesnona" },
        { key: "radiocomando", label: "Radiocomando, carica batterie e batteria (anche radiocomando di scorta)", bind: { group: "remote", field: "brand" }, serials: "remote", suggest: ["IMET"] },
        { key: "ctrl_semaforo", label: "Piantana semaforo con relative viti di fissaggio", input: "yesnona" },
        { key: "ctrl_chiavi", label: "Chiave serratura pedonale e lucchetti portellone (legate su centralina olio)", input: "yesnona" },
        { key: "ctrl_porta", label: "Chiusura e fissaggio porta pedonale laterale", input: "yesnona" },
        { key: "ctrl_adesivi_quadri", label: "Adesivi sicurezza su quadri elettrici e condizionatore", input: "yesnona" },
        { key: "ctrl_prese_aria", label: "Chiusura prese d'aria per trasporto", input: "yesnona" },
      ],
    },
  ],
};

export function sheetDef(kind: SheetKind): SheetDef {
  return kind === "CONTAINER" ? SHEET_CONTAINER : SHEET_TRITURATORE;
}

export function isSheetKind(v: unknown): v is SheetKind {
  return v === "TRITURATORE" || v === "CONTAINER";
}

/** Le schede di allestimento esistono solo per i BLUE DEVIL. */
export function hasAllestimentoSheets(plantType: string | null | undefined): boolean {
  return (plantType ?? "").trim().toUpperCase() === "BLUE DEVIL";
}

export function defaultTipo(kind: SheetKind, model: string): string {
  if (kind === "CONTAINER") return /DIESEL/i.test(model) ? "CONTAINER D" : "CONTAINER E";
  return "";
}

export function sheetCtx(kind: SheetKind, header: SheetHeader, model: string): SheetCtx {
  if (kind !== "CONTAINER") return { diesel: false };
  const tipo = header.tipo || defaultTipo(kind, model);
  return { diesel: tipo === "CONTAINER D" };
}

export function visibleRows(section: SheetSection, ctx: SheetCtx): SheetRow[] {
  return section.rows.filter((r) => !r.when || r.when(ctx));
}

export function allRows(def: SheetDef): SheetRow[] {
  return def.sections.flatMap((s) => s.rows);
}

/** Gruppi componente usati dalle schede (per crearli sulle macchine che non li hanno). */
export function sheetGroupIds(): string[] {
  const ids = new Set<string>();
  for (const def of [SHEET_TRITURATORE, SHEET_CONTAINER])
    for (const r of allRows(def)) {
      if (r.bind) ids.add(r.bind.group);
      if (r.serials) ids.add(r.serials);
    }
  return [...ids];
}

/** Commessa di riferimento stampata nell'intestazione della scheda. */
export function sheetCommessa(
  kind: SheetKind,
  m: { job: string; jobBody: string | null; jobContainer: string | null }
): string {
  return (kind === "CONTAINER" ? m.jobContainer : m.jobBody) || m.job;
}

type CompLike = { groupId: string; brand: string | null; extra: unknown };

/**
 * Valori della scheda come vanno mostrati/stampati: le specifiche collegate a un
 * gruppo componente vengono lette dal componente, le altre dalla scheda.
 */
export function resolveValues(
  kind: SheetKind,
  stored: SheetValues,
  comps: CompLike[],
  machine: { pressureSettings: string | null }
): SheetValues {
  const out: SheetValues = {};
  for (const row of allRows(sheetDef(kind))) {
    const s = stored[row.key] ?? {};
    let spec = s.spec ?? "";
    if (row.bind) {
      const c = comps.find((x) => x.groupId === row.bind!.group);
      if (row.bind.field === "brand") spec = c?.brand ?? "";
      else {
        const extra = (c?.extra ?? null) as Record<string, unknown> | null;
        spec = extra && typeof extra[row.bind.extraKey] === "string" ? (extra[row.bind.extraKey] as string) : "";
      }
    }
    // Il settaggio pressione della targa tecnica fa da valore iniziale.
    if (row.key === "taglio_pressione" && !spec) spec = machine.pressureSettings ?? "";
    out[row.key] = { spec, serial: s.serial ?? "", note: s.note ?? "" };
  }
  return out;
}
