// Schede di allestimento BLUE DEVIL: M5.16 Trituratore e M5.17 Container.
//
// Le righe che hanno una matricola non duplicano i dati: puntano ai gruppi
// componente già a sistema (COMPONENT_GROUPS). La "specifica" di quelle righe è
// la marca del gruppo (o un suo campo extra, es. tipo/lotto lame), le matricole
// sono gli slot del gruppo. Le altre voci (colori, fornitori, controlli) stanno
// nella scheda (`AllestimentoSheet.values`).
//
// Le specifiche a elenco partono dai valori `suggest` e si arricchiscono con le
// voci aggiunte dagli operatori (Setting `allestimentoOptions`, per elenco).
//
// Modulo condiviso client/server: niente import server-only.

export type SheetKind = "TRITURATORE" | "CONTAINER" | "MULINO" | "CESOIA";
export const SHEET_KINDS: SheetKind[] = ["TRITURATORE", "CONTAINER", "MULINO", "CESOIA"];

export type SheetInput = "text" | "yesno" | "yesnona";
export type SheetCtx = { diesel: boolean };

export type SheetRow = {
  key: string;
  label: string;
  input?: SheetInput; // default "text" = elenco a scelta con voci aggiungibili
  suggest?: string[]; // voci di partenza dell'elenco
  /** Campo libero (niente elenco): numeri, lotti, specifiche speciali. */
  free?: boolean;
  /** Elenco condiviso fra più righe (es. colori); default `${kind}.${key}`. */
  list?: string;
  /** La specifica si legge/scrive sul gruppo componente invece che sulla scheda. */
  bind?: { group: string; field: "brand" } | { group: string; field: "extra"; extraKey: string };
  /** Gruppo componente i cui slot forniscono le matricole della riga. */
  serials?: string;
  /** Matricola singola salvata nella scheda (es. targhetta CE). */
  serialField?: boolean;
  /** La colonna Matricola è un elenco (marca/fornitore), non un testo libero. */
  serialList?: string[];
  /** Specifica su tutta la larghezza (specifica + matricola), come nel modulo cartaceo. */
  wide?: boolean;
  when?: (ctx: SheetCtx) => boolean;
};

export type SheetSection = { key: string; title: string; subtitle?: string; icon: string; rows: SheetRow[] };

export type SheetDef = {
  kind: SheetKind;
  code: string;
  title: string;
  rev: string;
  /** Tipologie impianto che usano questa scheda. */
  plantTypes: string[];
  typeLabel: string;
  typeOptions?: string[];
  /** Campi d'intestazione oltre a commessa, paese e tipo. */
  headerFields?: ("collaudatoDa" | "matricola")[];
  sections: SheetSection[];
};

export type SheetValue = { spec?: string; serial?: string; note?: string };
export type SheetValues = Record<string, SheetValue>;
export type SheetHeader = { tipo?: string; collaudatoDa?: string; matricola?: string };
/** Voci aggiunte dagli operatori, per elenco. */
export type SheetOptions = Record<string, string[]>;

export const YES_NO = ["Sì", "No"];
export const YES_NO_NA = ["Sì", "No", "N.a."];
const COLORS = ["BLUE OPACO 5017", "BIANCO OPACO 9003"];
const PAINT = ["ZATO", "ZAMA"];
const PAINT_MULINO = ["ZATO", "ARIO", "ZAMA", "TEMPONI"];
const PREVISTO = ["Previsto", "Non previsto"];
const STD_CUSTOM = ["STANDARD", "CUSTOM"];
const GHIERE = ["CILINDRICA DIAMETRO EST. PICCOLO"];

const isElectric = (c: SheetCtx) => !c.diesel;
const isDiesel = (c: SheetCtx) => c.diesel;

export const SHEET_TRITURATORE: SheetDef = {
  kind: "TRITURATORE",
  code: "M5.16",
  title: "SCHEDA ALLESTIMENTO TRITURATORE",
  rev: "rev.00 Aprile 2023",
  plantTypes: ["BLUE DEVIL"],
  typeLabel: "TIPO GF",
  headerFields: ["collaudatoDa"],
  sections: [
    {
      key: "cavalletto",
      title: "ALLESTIMENTO CAVALLETTO TRAMOGGIA",
      icon: "box",
      rows: [
        { key: "costruttore_cavalletto", label: "Costruttore cavalletto e tramoggia", suggest: ["STAM"] },
        { key: "colore_cavalletto", label: "Colore cavalletto", suggest: COLORS, list: "colori" },
        { key: "colore_tramoggia", label: "Colore tramoggia", suggest: COLORS, list: "colori" },
        { key: "verniciatura_cavalletto", label: "Verniciatura", suggest: PAINT, list: "verniciatura" },
        { key: "targhetta_ce_impianto", label: "Targhetta CE impianto", suggest: ["ZATO"], list: "targhetta_ce" },
        { key: "speciali_cavalletto", label: "Specifiche speciali", free: true },
      ],
    },
    {
      key: "tubi",
      title: "ALLESTIMENTO LINEA TUBI",
      icon: "oil",
      rows: [
        { key: "layout", label: "Nr. Layout installazione", free: true },
        { key: "fornitore_tubi", label: "Fornitore tubi", suggest: ["FLUIDMEC"] },
        { key: "fornitore_tubi_rigidi", label: "Fornitore tubi rigidi", suggest: ["EFFEGI"] },
        { key: "lunghezza_linea", label: "Lunghezza linea ferro", suggest: ["STD"] },
        { key: "kit_ruotato", label: "Kit ruotato", input: "yesno" },
        { key: "speciali_tubi", label: "Specifiche speciali", free: true },
      ],
    },
    {
      key: "corpo",
      title: "ALLESTIMENTO CORPO MACCHINA",
      icon: "gear",
      rows: [
        { key: "targhetta_ce", label: "Targhetta CE Macchina", suggest: ["ZATO"], list: "targhetta_ce", serialField: true },
        { key: "riduttori", label: "Costruttore riduttori", bind: { group: "gearboxes", field: "brand" }, serials: "gearboxes", suggest: ["DINAMIC OIL"] },
        { key: "motori_idraulici", label: "Motori idraulici", bind: { group: "hyd_motors", field: "brand" }, serials: "hyd_motors", suggest: ["LINDE"] },
        { key: "blocchi_motore", label: "Blocchi motore", bind: { group: "motor_blocks", field: "brand" }, serials: "motor_blocks", suggest: ["MAGNUM"] },
        { key: "giunti_sicurezza", label: "Giunti sicurezza", input: "yesno" },
        { key: "lame", label: "Lame", bind: { group: "blades", field: "extra", extraKey: "type" }, suggest: ["PLATINUM"] },
        { key: "costruttore_lame", label: "Costruttori lame", bind: { group: "blades", field: "brand" }, suggest: ["CO.DI.TRA"] },
        { key: "lotto_lame", label: "Lotto lame", bind: { group: "blades", field: "extra", extraKey: "lot" }, free: true },
        { key: "lav_portalame", label: "Lav portalame - distanziali - alberi", suggest: ["DGS"], list: "lavorazioni" },
        { key: "montaggio_albero", label: "Montaggio albero", suggest: ["DGS"], list: "lavorazioni" },
        { key: "lotto_albero", label: "Lotto albero", free: true },
        { key: "lav_cassa", label: "Lav cassa", suggest: ["OFFICINE FN"], list: "lavorazioni" },
        { key: "corazzine", label: "Corazzine inferiori", input: "yesno" },
        { key: "materiale_ghiere", label: "Materiale ghiere", suggest: ["C45"] },
        { key: "ghiera_portalama", label: "Tipo ghiera lato libero con portalama", suggest: GHIERE, list: "ghiere", wide: true },
        { key: "ghiera_distanziale", label: "Tipo ghiera lato libero con distanziale", suggest: GHIERE, list: "ghiere", wide: true },
        { key: "colore_corpo", label: "Colore corpo macchina", suggest: COLORS, list: "colori" },
        { key: "verniciatura_corpo", label: "Verniciatura", suggest: PAINT, list: "verniciatura" },
        { key: "spedizione_corpo", label: "Tipo spedizione corpo", suggest: ["MONTATO", "SMONTATO"] },
      ],
    },
    {
      key: "controlli",
      title: "CONTROLLI FINALI",
      icon: "check",
      rows: [
        { key: "ctrl_visivo", label: "Controllo visivo generale macchina", input: "yesnona" },
        { key: "ctrl_sfregamenti", label: "Controllo sfregamenti anomali su settori pulitori", input: "yesnona" },
        { key: "ctrl_riduttori", label: "Controllo montaggio riduttori (sfiati, tappi)", input: "yesnona" },
        { key: "ctrl_oring", label: "Controllo guarnizione O-Ring tra motore e riduttore", input: "yesnona" },
        { key: "ctrl_lame", label: "Controllo spazio tra lama e lama (0,5 mm)", input: "yesnona" },
        { key: "ctrl_verniciatura", label: "Controllo verniciatura", input: "yesnona" },
        { key: "ctrl_adesivi", label: "Controllo applicazione adesivi e pittogrammi", input: "yesnona" },
        { key: "speciali_controlli", label: "Specifiche speciali", free: true },
      ],
    },
  ],
};

export const SHEET_CONTAINER: SheetDef = {
  kind: "CONTAINER",
  code: "M5.17",
  title: "SCHEDA ALLESTIMENTO CONTAINER",
  rev: "Rev. 00 maggio 22",
  plantTypes: ["BLUE DEVIL"],
  typeLabel: "TIPO GF",
  typeOptions: ["CONTAINER E", "CONTAINER D"],
  headerFields: ["collaudatoDa"],
  sections: [
    {
      key: "container",
      title: "ALLESTIMENTO CONTAINER",
      icon: "box",
      rows: [
        { key: "nr_motori", label: "Nr. Motori Elettrici", free: true, when: isElectric },
        { key: "potenza_motori", label: "Potenza motori (kW)", free: true },
        { key: "tensione_motori", label: "Tensione motore (V)", suggest: ["400", "690"], list: "tensione", when: isElectric },
        { key: "frequenza_motori", label: "Frequenza (Hz)", suggest: ["50", "60"], list: "frequenza", when: isElectric },
        { key: "marca_motori", label: "Marca motori", bind: { group: "electric_motor", field: "brand" }, serials: "electric_motor", suggest: ["SIMOTOP"], when: isElectric },
        { key: "motore_diesel", label: "Motore diesel", bind: { group: "diesel", field: "brand" }, serials: "diesel", when: isDiesel },
        { key: "costruttore_container", label: "Costruttori Container", bind: { group: "container", field: "brand" }, serials: "container", suggest: ["ECOFER"] },
        { key: "coibentazione", label: "Coibentazione Container", input: "yesno" },
        { key: "condizionatore", label: "Costruttore Condizionatore", bind: { group: "cooling", field: "brand" }, serials: "cooling" },
        { key: "tensione_condizionatore", label: "Tensione Condizionatore (V)", suggest: ["400", "230"], list: "tensione" },
        { key: "frequenza_condizionatore", label: "Frequenza Condizionatore (Hz)", suggest: ["50", "60"], list: "frequenza" },
        { key: "centrale_idraulica", label: "Centrale Idraulica", bind: { group: "hyd_unit", field: "brand" }, serials: "hyd_unit", suggest: ["MAGNUM"] },
        { key: "pompe", label: "Pompe idrauliche (Pompa 1 / Pompa 2)", bind: { group: "hyd_pumps", field: "brand" }, serials: "hyd_pumps", suggest: ["LINDE"] },
        { key: "valvola_max", label: "Valvola Max", bind: { group: "hyd_pumps", field: "extra", extraKey: "valves" }, free: true },
        { key: "taglio_pressione", label: "Valore taglio di pressione", free: true },
        { key: "pompe_sovralimentazione", label: "Pompe sovralimentaz. e raffreddamento", bind: { group: "boost_pumps", field: "brand" }, serials: "boost_pumps", suggest: ["B & C"] },
        { key: "pompa_grasso", label: "Pompa Grasso", bind: { group: "grease", field: "brand" }, serials: "grease", suggest: ["CIAPONI"] },
        { key: "nr_radiatori", label: "Nr. Radiatori", free: true },
        { key: "radiatori", label: "Radiatori", bind: { group: "dissipators", field: "brand" }, serials: "dissipators", suggest: ["SESINO"] },
        { key: "installazione_radiatori", label: "Tipo installazione Radiatori", suggest: ["A TETTO", "LATERALE"] },
        { key: "radiatore_marino", label: "Radiatore modello marino", input: "yesno" },
        { key: "colore_container", label: "Colore container", suggest: COLORS, list: "colori" },
        { key: "speciali_container", label: "Specifiche speciali", free: true },
      ],
    },
    {
      key: "elettrico",
      title: "QUADRO ELETTRICO E COMANDI",
      subtitle: "Voci a sistema, non presenti sul modulo rev.00",
      icon: "panel",
      rows: [
        { key: "quadro_elettrico", label: "Quadro elettrico", bind: { group: "cabinet", field: "brand" }, serials: "cabinet" },
        { key: "hmi", label: "HMI", bind: { group: "hmi", field: "brand" }, serials: "hmi" },
      ],
    },
    {
      key: "spedizione",
      title: "CONTROLLI PRIMA DELLA SPEDIZIONE",
      icon: "check",
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

export const SHEET_MULINO: SheetDef = {
  kind: "MULINO",
  code: "M5.6",
  title: "SCHEDA ALLESTIMENTO MULINO",
  rev: "rev.00 Giu 2023",
  plantTypes: ["BLUE SHARK"],
  typeLabel: "TIPO MULINO",
  typeOptions: ["12-10", "16-13", "19-22"],
  headerFields: ["matricola"],
  sections: [
    {
      key: "elettrico",
      title: "ALIMENTAZIONE MULINO ELETTRICO",
      icon: "bolt",
      rows: [
        { key: "potenza_motore", label: "Potenza motore (kW)", free: true },
        { key: "tensione_motore", label: "Tensione motore (V)", suggest: ["400", "690"], list: "tensione" },
        { key: "frequenza_motore", label: "Frequenza (Hz)", suggest: ["50", "60"], list: "frequenza" },
        { key: "marca_motori", label: "Marca motori", bind: { group: "electric_motor", field: "brand" }, serials: "electric_motor" },
      ],
    },
    {
      key: "diesel",
      title: "ALIMENTAZIONE MULINO DIESEL",
      icon: "engine",
      rows: [
        { key: "potenza_diesel", label: "Potenza motori (HP)", free: true },
        { key: "classe_emissioni", label: "Classe emissioni motore", suggest: ["STAGE 0", "STAGE IIIA", "STAGE V", "TIER IVF"] },
        { key: "marca_motore_diesel", label: "Marca motore", bind: { group: "diesel", field: "brand" }, serials: "diesel" },
        { key: "marca_radiatore", label: "Marca radiatore", bind: { group: "dissipators", field: "brand" }, serials: "dissipators" },
      ],
    },
    {
      key: "impianto",
      title: "ALLESTIMENTO IMPIANTO",
      icon: "box",
      rows: [
        { key: "costruttore_container", label: "Costruttori Container", bind: { group: "container", field: "brand" }, serials: "container", suggest: ["SOGECO", "ECOFER"] },
        { key: "coibentazione", label: "Coibentazione Container", input: "yesno" },
        { key: "condizionatore", label: "Costruttore Condizionatore", bind: { group: "cooling", field: "brand" }, serials: "cooling", suggest: ["MITSUBISHI", "NON PRESENTE"] },
        { key: "quadro_elettrico", label: "Quadro elettrico", bind: { group: "cabinet", field: "brand" }, serials: "cabinet" },
        { key: "cassa_giunto", label: "Cassa giunto", suggest: PREVISTO, list: "previsto", serialList: ["IMI", "RIVAL", "AVEROLDI"] },
        { key: "giunto_idraulico", label: "Giunto idraulico completo", suggest: PREVISTO, list: "previsto", serialList: ["SEW", "ALTRO"] },
        { key: "impalcato", label: "Impalcato", suggest: ["ECOFER", "TRUSSARDI", "STAM"] },
        { key: "corpo_mulino", label: "Corpo mulino", suggest: ["IMI", "RIVAL", "AVEROLDI"] },
        { key: "rotore_scudato", label: "Rotore scudato", input: "yesno" },
        { key: "martelli", label: "Martelli", suggest: ["OSSITAGLIO", "FUSIONE"], serialList: ["PSP", "CODITRA", "GELLI"] },
        { key: "griglie", label: "Griglie", suggest: ["90x90", "100x120", "100x140", "160x160", "200x200"], serialList: ["PSP", "GELLI"] },
        { key: "piano_vibrante", label: "Piano vibrante" },
        { key: "centrale_idraulica", label: "Centrale Idraulica", bind: { group: "hyd_unit", field: "brand" }, serials: "hyd_unit", suggest: ["MAGNUM"] },
        { key: "tamburo_magnetico", label: "Tamburo magnetico", suggest: PREVISTO, list: "previsto", serialList: ["TORRI", "SGM", "GAUSS", "DARTEK"] },
        { key: "linea_aspirazione", label: "Impianto linea aspirazione", suggest: PREVISTO, list: "previsto", serialList: ["TVT", "ALTRO"] },
        { key: "insonorizzazione", label: "Insonorizzazione", suggest: PREVISTO, list: "previsto", serialList: ["MIRO", "ALTRO"] },
        { key: "impianto_separazione", label: "Impianto separazione", suggest: PREVISTO, list: "previsto", serialList: ["ITALSORT", "DECCA", "TELANDRO"] },
        { key: "verniciatura_corpo", label: "Verniciatura corpo", suggest: PAINT_MULINO, list: "verniciatura" },
        { key: "verniciatura_impalcato", label: "Verniciatura impalcato", suggest: PAINT_MULINO, list: "verniciatura" },
        { key: "imballaggio", label: "Imballaggio", suggest: ["PARZIALE", "TOTALE", "NON PREVISTO"], serialList: ["EUROIMBALLI", "ALTRO"] },
        { key: "colore", label: "Colore", suggest: COLORS, list: "colori" },
      ],
    },
  ],
};

export const SHEET_CESOIA: SheetDef = {
  kind: "CESOIA",
  code: "M5.18",
  title: "SCHEDA COSTRUZIONE CESOIE",
  rev: "rev.00 Aprile 2023",
  plantTypes: ["CESOIE", "SPACCABINARI"],
  typeLabel: "MODELLO MACCHINA",
  headerFields: ["matricola"],
  sections: [
    {
      key: "cilindro",
      title: "CILINDRO",
      icon: "oil",
      rows: [
        { key: "marca_cilindro", label: "Marca cilindro", serialField: true },
        { key: "spessori_post_lame", label: "Spessori posteriori - lato lame (mm)", free: true },
        { key: "spessori_post_guida", label: "Spessori posteriori - lato lama guida (mm)", free: true },
        { key: "spessori_ant_lame", label: "Spessori anteriori - lato lame (mm)", free: true },
        { key: "spessori_ant_guida", label: "Spessori anteriori - lato lama guida (mm)", free: true },
        { key: "tubi_link", label: "Tubi flessibili link", suggest: STD_CUSTOM, list: "standard_custom" },
        { key: "tubi_cilindro", label: "Tubi flessibili cilindro", suggest: STD_CUSTOM, list: "standard_custom" },
        { key: "valvola_rigenerativa", label: "Valvola rigenerativa (modello)", serialField: true },
      ],
    },
    {
      key: "lame",
      title: "LAME",
      icon: "blade",
      rows: [
        { key: "produttore_lame", label: "Produttore", suggest: ["CO.DI.TRA", "PSP", "GELLI"] },
        { key: "durezza_puntali", label: "Durezza puntali", free: true },
      ],
    },
    {
      key: "ralla",
      title: "RALLA",
      icon: "gear",
      rows: [{ key: "ralla_marca", label: "Marca (matricola = codice)", serialField: true }],
    },
    {
      key: "motoriduttore",
      title: "MOTORIDUTTORE",
      icon: "rotor",
      rows: [
        { key: "mr_marca", label: "Marca (matricola = codice motore)", serialField: true },
        { key: "mr_codice_riduttore", label: "Codice riduttore", free: true },
        { key: "mr_codice_valvola", label: "Codice valvola", free: true },
      ],
    },
    {
      key: "vernice",
      title: "VERNICE (RAL)",
      icon: "drop",
      rows: [{ key: "vernice_ral", label: "Vernice (RAL)", suggest: ["STANDARD (RAL 9005)"], wide: true }],
    },
    {
      key: "giunto",
      title: "GIUNTO GIREVOLE",
      icon: "boost",
      rows: [
        { key: "giunto_marca", label: "Marca (matricola = codice)", serialField: true },
        {
          key: "raccorderia",
          label: "Tipo raccorderia entrata giunto girevole",
          suggest: ["BLOCCHETTI STANDARD", "GIUNTINI GIREVOLI", "SENZA BLOCCHETTI PER ATTACCO RAPIDO"],
          wide: true,
        },
      ],
    },
    {
      key: "note",
      title: "NOTE PER PARTICOLARI VARI",
      icon: "doc",
      rows: [{ key: "note_particolari", label: "Note", free: true, wide: true }],
    },
  ],
};

const SHEET_DEFS: Record<SheetKind, SheetDef> = {
  TRITURATORE: SHEET_TRITURATORE,
  CONTAINER: SHEET_CONTAINER,
  MULINO: SHEET_MULINO,
  CESOIA: SHEET_CESOIA,
};

export function sheetDef(kind: SheetKind): SheetDef {
  return SHEET_DEFS[kind];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Etichetta del campo matricola in intestazione, per le schede che lo hanno. */
export const MATRICOLA_LABEL: Partial<Record<SheetKind, string>> = {
  MULINO: "Matricola impianto",
  CESOIA: "Matricola macchina",
};

/** Schede previste per una tipologia impianto (vuoto = nessuna, per ora). */
export function sheetKindsFor(plantType: string | null | undefined): SheetKind[] {
  const p = norm(plantType);
  return p ? SHEET_KINDS.filter((k) => SHEET_DEFS[k].plantTypes.includes(p)) : [];
}

export function isSheetKind(v: unknown): v is SheetKind {
  return typeof v === "string" && (SHEET_KINDS as string[]).includes(v);
}

/** La tipologia impianto ha schede di allestimento? */
export function hasAllestimentoSheets(plantType: string | null | undefined): boolean {
  return sheetKindsFor(plantType).length > 0;
}

/** Tipo GF del trituratore: fisso, i BLUE DEVIL sono tutti GF4000. */
export const TIPO_GF_TRITURATORE = "GF4000";

export function defaultTipo(kind: SheetKind, model: string): string {
  if (kind === "CONTAINER") return /DIESEL/i.test(model) ? "CONTAINER D" : "CONTAINER E";
  if (kind === "TRITURATORE") return TIPO_GF_TRITURATORE;
  // Mulino e cesoia: si parte dal modello del fascicolo, se e' fra le scelte.
  const def = sheetDef(kind);
  const m = model.trim();
  if (!def.typeOptions) return m;
  return def.typeOptions.find((o) => o.toUpperCase() === m.toUpperCase()) ?? "";
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

/** La riga si compila scegliendo da un elenco (con voci aggiungibili)? */
export function isListRow(row: SheetRow): boolean {
  return (row.input ?? "text") === "text" && !row.free;
}

/** Chiave dell'elenco di una riga: condiviso (`list`) o proprio della riga. */
export function listKey(kind: SheetKind, row: SheetRow): string {
  return row.list ?? `${kind}.${row.key}`;
}

/** Chiave dell'elenco della colonna Matricola (le marche del modulo cartaceo). */
export function serialListKey(kind: SheetKind, row: SheetRow): string {
  return `${kind}.${row.key}#marca`;
}

/** Tutte le chiavi di elenco valide (per validare le voci aggiunte). */
export function allListKeys(): Set<string> {
  const keys = new Set<string>();
  for (const kind of SHEET_KINDS)
    for (const r of allRows(SHEET_DEFS[kind])) {
      if (isListRow(r)) keys.add(listKey(kind, r));
      if (r.serialList) keys.add(serialListKey(kind, r));
    }
  return keys;
}

/** Voci di un elenco: quelle di partenza più le aggiunte, senza doppioni. */
export function listOptions(kind: SheetKind, row: SheetRow, custom: SheetOptions): string[] {
  return mergeOptions(row.suggest ?? [], custom[listKey(kind, row)] ?? []);
}

/** Voci dell'elenco nella colonna Matricola. */
export function serialListOptions(kind: SheetKind, row: SheetRow, custom: SheetOptions): string[] {
  return mergeOptions(row.serialList ?? [], custom[serialListKey(kind, row)] ?? []);
}

function mergeOptions(base: string[], added: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of [...base, ...added]) {
    const k = o.trim().toUpperCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(o.trim());
  }
  return out;
}

/** Gruppi componente usati dalle schede indicate (per crearli sulle macchine). */
export function sheetGroupIds(kinds: SheetKind[] = SHEET_KINDS): string[] {
  const ids = new Set<string>();
  for (const kind of kinds)
    for (const r of allRows(SHEET_DEFS[kind])) {
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
  if (kind === "CONTAINER") return m.jobContainer || m.job;
  if (kind === "TRITURATORE") return m.jobBody || m.job;
  return m.job; // mulino e cesoia: una sola commessa
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
