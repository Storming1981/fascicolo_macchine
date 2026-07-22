// Check list di cantiere per intervento — DOCUMENTO UNICO "Ambiente e Sicurezza".
// Contenuto dai file di riferimento ZATO ("Checklist Ambiente di cantiere.docx" e
// "Checklist sicurezza Preposti rev.01.docx"), unificati: prima le sezioni
// ambientali, poi quelle di sicurezza, in coda note e azioni correttive.

export type ChecklistType = "AMBIENTE_SICUREZZA";

export type ChecklistItem = { key: string; label: string };
export type ChecklistSection = { title: string; intro?: string; items: ChecklistItem[] };
export type ChecklistTextField = { key: string; label: string; multiline?: boolean };

export type ChecklistDef = {
  type: ChecklistType;
  title: string;
  intro?: string;
  headerFields: ChecklistTextField[]; // campi testata manuali (le date sono autocompilate)
  sections: ChecklistSection[];
  notes: ChecklistTextField[]; // note / azioni correttive
  clientSignature: boolean; // oltre alla firma del preposto, prevede quella cliente
  spacious?: boolean; // impaginazione PDF più arieggiata
};

export const CHECKLIST_AMBIENTE_SICUREZZA: ChecklistDef = {
  type: "AMBIENTE_SICUREZZA",
  title: "Checklist Ambiente e Sicurezza",
  intro:
    "Con la firma del presente report, il preposto attesta di aver preso visione dei rischi interferenziali (DUVRI/PSC) e di vigilare attivamente sia sul coordinamento e sulla compatibilità delle lavorazioni con le dinamiche esterne del cantiere (transiti, impianti e simultaneità), sia sulla corretta applicazione delle misure di tutela e conformità ambientale.",
  // Ditta, indirizzo e date NON si compilano a mano: nel PDF si autocompilano
  // dall'anagrafica cliente/cantiere e dalle date pianificate dell'intervento.
  headerFields: [],
  sections: [
    /* ───────────── Ambiente ───────────── */
    {
      title: "1. Sostanze Pericolose e Sversamenti",
      items: [
        { key: "amb_a1", label: "Prodotti chimici e oli stoccati in sicurezza all'interno delle apposite vasche di contenimento." },
        { key: "amb_a2", label: "Kit anti-sversamento e Schede di Dati di Sicurezza (SDS) sempre presenti e facilmente accessibili." },
        { key: "amb_a3", label: "Tombini e griglie di scolo adiacenti all'area di lavoro preventivamente protetti da sversamenti accidentali." },
      ],
    },
    {
      title: "2. Gestione e Stoccaggio Rifiuti",
      items: [
        { key: "amb_b1", label: "Rifiuti differenziati per codice EER e stoccati esclusivamente nell'area delimitata e dedicata." },
        { key: "amb_b2", label: "Contenitori dei rifiuti pericolosi adeguatamente coperti e protetti dalla pioggia e dagli agenti atmosferici." },
      ],
    },
    {
      title: "3. Aria, Rumore e Polveri",
      items: [
        { key: "amb_c1", label: "Sistemi di aspirazione fumi regolarmente utilizzati durante le operazioni di saldatura in ambienti chiusi." },
        { key: "amb_c2", label: "Motori, gruppi elettrogeni e macchinari rigorosamente spenti durante le pause lavorative." },
      ],
    },
    {
      title: "4. Acque e Pulizia Finale",
      items: [
        { key: "amb_d1", label: "Assoluto divieto di scarico di acque di lavaggio contaminate (da vernici o oli) sul suolo o in rete fognaria." },
        { key: "amb_d2", label: "Area di montaggio accuratamente pulita da sfridi, trucioli e polveri metalliche al termine di ogni turno lavorativo." },
      ],
    },
    /* ───────────── Sicurezza ───────────── */
    {
      title: "5. Personale & Formazione",
      intro: "Tutto il personale presente in cantiere è:",
      items: [
        { key: "sic_1a", label: "autorizzato" },
        { key: "sic_1b", label: "formato e addestrato (es. quota/DPI 3ª cat.)" },
        { key: "sic_1c", label: "abilitato all'uso delle specifiche macchine (es. PLE, gru, carrelli elevatori)" },
      ],
    },
    {
      title: "6. DPI (Dispositivi di Protezione Individuale)",
      intro: "I DPI (elmetti, imbracature, scarpe, ecc.) sono:",
      items: [
        { key: "sic_2a", label: "coerenti con l'attività" },
        { key: "sic_2b", label: "in buono stato" },
        { key: "sic_2c", label: "indossati correttamente" },
      ],
    },
    {
      title: "7. Attrezzature (Verifica palese)",
      intro:
        "Le attrezzature di lavoro, sollevamento e accesso in quota (trabattelli, piattaforme aeree - PLE, scale a castello) sono:",
      items: [
        { key: "sic_3a", label: "integre" },
        { key: "sic_3b", label: "posizionate stabilmente" },
        { key: "sic_3c", label: "con verifiche periodiche in corso di validità" },
      ],
    },
    {
      title: "8. Area di Lavoro & Stoccaggi materiali",
      intro: "L'area è in ordine, le vie di fuga sono:",
      items: [
        { key: "sic_4a", label: "libere" },
        { key: "sic_4b", label: "i componenti sono stoccati stabilmente" },
        { key: "sic_4c", label: "le zone con rischio caduta materiali sono delimitate e segnalate" },
      ],
    },
    {
      title: "9. Procedure e Istruzioni di Sicurezza",
      intro: "Le attività si svolgono:",
      items: [
        { key: "sic_5a", label: "nel rispetto del POS" },
        { key: "sic_5b", label: "delle procedure aziendali" },
        { key: "sic_5c", label: "delle distanze da linee elettriche e dei carichi sospesi" },
      ],
    },
    {
      title: "10. Anomalie & Emergenze",
      items: [
        { key: "sic_6a", label: 'Non si segnalano malfunzionamenti o "near miss" (quasi incidenti)' },
        { key: "sic_6b", label: "Le vie di fuga e i sistemi di emergenza del sito sono noti e liberi" },
      ],
    },
  ],
  notes: [
    { key: "noteAnomalie", label: "Note / Anomalie riscontrate", multiline: true },
    { key: "azioniCorrettive", label: "Azioni correttive immediate", multiline: true },
  ],
  clientSignature: true,
  spacious: false, // documento lungo: impaginazione compatta
};

export const CHECKLIST_DEFS: Record<ChecklistType, ChecklistDef> = {
  AMBIENTE_SICUREZZA: CHECKLIST_AMBIENTE_SICUREZZA,
};

export const CHECKLIST_TYPES: ChecklistType[] = ["AMBIENTE_SICUREZZA"];

export function checklistItemKeys(def: ChecklistDef): string[] {
  return def.sections.flatMap((s) => s.items.map((i) => i.key));
}

export function checklistProgress(
  def: ChecklistDef,
  answers: Record<string, string> | null | undefined
): { done: number; total: number } {
  const keys = checklistItemKeys(def);
  const a = answers ?? {};
  return { done: keys.filter((k) => a[k]).length, total: keys.length };
}
