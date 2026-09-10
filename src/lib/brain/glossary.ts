import { prisma } from "@/lib/db";

/**
 * Dizionario tecnico ZATO.
 *
 * Serve a colmare la distanza fra come parla il cantiere e come scrive il
 * manuale: il tecnico digita "il rotore si pianta", il manuale dice "bloccaggio
 * del rotore / intervento della protezione di sovraccarico". Senza dizionario la
 * ricerca full-text non trova nulla.
 *
 * Viene usato in due punti:
 *  1. espansione della query prima della ricerca (alias → termine canonico);
 *  2. nel system prompt del Brain, così il modello usa il lessico ZATO corretto.
 */

export type Term = {
  term: string;
  aliases: string[];
  definition: string | null;
  category: string;
  plantType: string | null;
};

/** Voci di partenza: coprono il gergo più frequente dei rapportini ZATO. */
export const SEED_TERMS: (Omit<Term, "plantType" | "definition"> & { definition?: string })[] = [
  // ── Processo / impianto ──
  { term: "Trituratore", aliases: ["mulino", "shredder", "corpo trituratore", "frantumatore"], category: "Processo", definition: "Gruppo che riduce il rottame; nella gamma ZATO è il corpo della BLUE DEVIL o della BLUE SHARK." },
  { term: "Rotore", aliases: ["albero rotore", "girante", "rotor"], category: "Meccanica", definition: "Organo rotante del trituratore su cui sono montati martelli o coltelli." },
  { term: "Martelli", aliases: ["mazze", "hammer", "martelletti", "utensili di frantumazione"], category: "Meccanica", definition: "Utensili battenti calettati sul rotore; usura di consumo, sostituzione periodica." },
  { term: "Lame", aliases: ["coltelli", "blades", "taglienti", "cesoia lame"], category: "Meccanica", definition: "Elementi di taglio di cesoie e mulini; si affilano o si ruotano prima della sostituzione." },
  { term: "Griglia", aliases: ["griglie", "crivello", "vaglio inferiore", "grate"], category: "Processo", definition: "Determina la pezzatura in uscita del materiale triturato." },
  { term: "Controlama", aliases: ["contro lama", "controcoltello", "matrice di taglio"], category: "Meccanica", definition: "Elemento fisso contrapposto alla lama; il gioco lama-controlama è critico per la qualità di taglio." },
  { term: "Nastro trasportatore", aliases: ["nastro", "convogliatore", "belt", "trasportatore"], category: "Processo", definition: "Movimentazione del materiale in ingresso o in uscita dall'impianto." },
  { term: "Separatore magnetico", aliases: ["overband", "magnete", "deferrizzatore", "separatore a nastro magnetico"], category: "Processo", definition: "Estrae la frazione ferrosa dal flusso di materiale." },
  { term: "Separatore a correnti indotte", aliases: ["eddy current", "ECS", "separatore non ferrosi"], category: "Processo", definition: "Separa i metalli non ferrosi (alluminio, rame) dalla frazione inerte." },
  { term: "Tramoggia", aliases: ["bocca di carico", "hopper", "cassone di carico"], category: "Processo", definition: "Volume di carico del materiale in ingresso." },
  { term: "Spingitore", aliases: ["pusher", "slitta di spinta", "carro di spinta"], category: "Meccanica", definition: "Cilindro che spinge il materiale verso la zona di taglio nelle cesoie." },
  { term: "Premipezzo", aliases: ["pressore", "hold down", "premi materiale"], category: "Meccanica", definition: "Blocca il materiale durante il taglio nelle cesoie CAYMAN." },

  // ── Idraulica ──
  { term: "Centralina idraulica", aliases: ["power pack", "gruppo idraulico", "centralina oleodinamica", "PTO idraulico"], category: "Idraulica", definition: "Gruppo pompe, serbatoio e valvole che alimenta i circuiti oleodinamici." },
  { term: "Pompa a pistoni", aliases: ["pompa principale", "pompa idraulica", "pompa a portata variabile"], category: "Idraulica" },
  { term: "Cilindro idraulico", aliases: ["martinetto", "pistone", "attuatore lineare"], category: "Idraulica" },
  { term: "Valvola di massima pressione", aliases: ["valvola di sicurezza", "limitatrice", "relief valve", "taratura pressione"], category: "Idraulica", definition: "Tara la pressione massima del circuito; i valori sono nella targa tecnica del fascicolo." },
  { term: "Scambiatore di calore", aliases: ["radiatore olio", "raffreddatore", "cooler"], category: "Idraulica", definition: "Mantiene in temperatura l'olio idraulico; se sporco causa surriscaldamento e blocchi." },
  { term: "Filtro olio", aliases: ["cartuccia filtro", "filtro in mandata", "filtro di ritorno", "filtro sul ritorno"], category: "Idraulica" },
  { term: "Surriscaldamento olio", aliases: ["olio caldo", "olio bollente", "temperatura olio alta", "allarme temperatura olio"], category: "Idraulica", definition: "Tipicamente scambiatore intasato, livello olio basso o valvola tarata male." },
  { term: "Trafilamento", aliases: ["perdita olio", "gocciolamento", "perde olio", "trasuda olio"], category: "Idraulica" },

  // ── Elettrico / automazione ──
  { term: "Quadro elettrico", aliases: ["quadro di comando", "armadio elettrico", "cabina elettrica", "container elettrico"], category: "Elettrico" },
  { term: "PLC", aliases: ["controllore", "logica programmabile", "Siemens S7", "programma macchina"], category: "Elettrico" },
  { term: "Pannello operatore", aliases: ["HMI", "touch", "display", "pannello touch", "terminale operatore"], category: "Elettrico" },
  { term: "Inverter", aliases: ["variatore di frequenza", "drive", "VFD", "azionamento"], category: "Elettrico" },
  { term: "Soft starter", aliases: ["avviatore statico", "avviamento dolce"], category: "Elettrico" },
  { term: "Termica", aliases: ["relè termico", "protezione termica", "scatto termica", "salvamotore"], category: "Elettrico", definition: "Protezione da sovraccarico del motore; il riarmo va fatto dopo aver rimosso la causa." },
  { term: "Finecorsa", aliases: ["fine corsa", "switch di posizione", "sensore di posizione", "limit switch"], category: "Elettrico" },
  { term: "Encoder", aliases: ["trasduttore di posizione", "rilevatore giri"], category: "Elettrico" },
  { term: "Sensore induttivo", aliases: ["prossimità", "proximity", "induttivo"], category: "Elettrico" },

  // ── Trasmissione ──
  { term: "Riduttore", aliases: ["gearbox", "gruppo riduzione", "rinvio angolare"], category: "Meccanica" },
  { term: "Giunto", aliases: ["accoppiamento", "coupling", "giunto elastico"], category: "Meccanica" },
  { term: "Cuscinetto", aliases: ["bearing", "supporto", "cuscinetto a rulli", "supporto rotore"], category: "Meccanica" },
  { term: "Cinghie", aliases: ["cinghia trapezoidale", "pulegge", "trasmissione a cinghia", "tensionamento cinghie"], category: "Meccanica" },

  // ── Sicurezza / cantiere ──
  { term: "P.O.S.", aliases: ["POS", "piano operativo di sicurezza", "piano sicurezza"], category: "Sicurezza", definition: "Documento obbligatorio prima di pianificare qualsiasi intervento in cantiere ZATO." },
  { term: "LOTO", aliases: ["lock out tag out", "messa in sicurezza", "sezionamento", "consegna impianto"], category: "Sicurezza", definition: "Procedura di sezionamento e blocco delle energie prima di operare sull'impianto." },
  { term: "DPI", aliases: ["dispositivi di protezione individuale", "protezioni individuali"], category: "Sicurezza" },
  { term: "Fungo di emergenza", aliases: ["emergenza", "pulsante di emergenza", "e-stop", "arresto di emergenza"], category: "Sicurezza" },
  { term: "Rapportino", aliases: ["rapporto di intervento", "foglio lavoro", "report giornaliero", "rapportino giornaliero"], category: "Cantiere", definition: "Rapporto giornaliero compilato in cantiere: ore, lavorazioni, ricambi, problematiche." },

  // ── Comandi macchina ──
  // Lo stemmer italiano di Postgres NON lega il verbo al sostantivo:
  // "accendere" -> accend, "accensione" -> accension. Chi scrive "come accendo
  // l'impianto" non troverebbe mai il capitolo "6.2.1 Accensione". Queste voci
  // colmano proprio quel salto.
  { term: "Accensione", aliases: ["accendere", "accendo", "avviare", "avviamento", "far partire", "mettere in moto", "dare tensione", "start", "avvio"], category: "Processo", definition: "Sequenza di avvio dell'impianto; l'ordine dei gruppi va rispettato (centralina, lubrificazione, nastri, rotore)." },
  { term: "Arresto", aliases: ["spegnere", "spegnimento", "fermare", "arrestare", "stop", "fermo macchina", "fine ciclo"], category: "Processo", definition: "Arresto ordinato dell'impianto, distinto dall'arresto di emergenza." },
  { term: "Messa in servizio", aliases: ["primo avviamento", "commissioning", "avviamento iniziale", "collaudo in campo"], category: "Processo", definition: "Primo avviamento dell'impianto: di competenza dei tecnici della ditta costruttrice." },
  { term: "Verifiche preliminari", aliases: ["controlli prima dell avvio", "check prima di partire", "controlli preliminari"], category: "Processo" },
  { term: "Ciclo di lavoro", aliases: ["produzione", "lavorazione", "marcia", "esercizio"], category: "Processo" },

  // ── Manutenzione ──
  { term: "Manutenzione preventiva", aliases: ["manutenzione programmata", "tagliando", "controllo periodico"], category: "Manutenzione" },
  { term: "Ingrassaggio", aliases: ["lubrificazione", "grasso", "punti di ingrassaggio", "ingrassatore"], category: "Manutenzione" },
  { term: "Serraggio", aliases: ["coppia di serraggio", "tiraggio bulloni", "torque", "chiave dinamometrica"], category: "Manutenzione" },
  { term: "Usura", aliases: ["consumo", "logoramento", "parte usurata", "ricambio di usura"], category: "Manutenzione" },
  { term: "Contaore", aliases: ["ore macchina", "ore impianto", "ore di lavoro"], category: "Manutenzione", definition: "Ore operative dell'impianto: guida gli intervalli di manutenzione." },
];

/** Legge il dizionario dal DB (vuoto → array vuoto, il Brain funziona lo stesso). */
export async function loadGlossary(): Promise<Term[]> {
  const rows = await prisma.knowledgeTerm.findMany({ orderBy: { term: "asc" } });
  return rows.map((r) => ({
    term: r.term,
    aliases: r.aliases,
    definition: r.definition,
    category: r.category,
    plantType: r.plantType,
  }));
}

/** Popola il dizionario con le voci di partenza (idempotente). */
export async function seedGlossary(): Promise<number> {
  let created = 0;
  for (const t of SEED_TERMS) {
    const exists = await prisma.knowledgeTerm.findUnique({ where: { term: t.term } });
    if (exists) continue;
    await prisma.knowledgeTerm.create({
      data: { term: t.term, aliases: t.aliases, definition: t.definition ?? null, category: t.category },
    });
    created++;
  }
  return created;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Espande la query con i termini canonici del dizionario: se il testo contiene
 * un alias, aggiunge il termine ufficiale (e viceversa). È deterministico e
 * gratuito — gira prima di qualsiasi chiamata al modello.
 */
export function expandWithGlossary(query: string, glossary: Term[]): { terms: string[]; matched: Term[] } {
  const q = norm(query);
  const terms = new Set<string>();
  const matched: Term[] = [];
  for (const t of glossary) {
    const variants = [t.term, ...t.aliases];
    const hit = variants.some((v) => {
      const n = norm(v);
      return n.length > 2 && q.includes(n);
    });
    if (!hit) continue;
    matched.push(t);
    for (const v of variants) terms.add(v);
  }
  return { terms: [...terms], matched };
}

/**
 * Rende il dizionario come testo per il system prompt. Sta in prompt cache
 * insieme al resto delle istruzioni: si paga una volta, non a ogni domanda.
 */
export function glossaryPrompt(glossary: Term[]): string {
  if (glossary.length === 0) return "";
  const byCat = new Map<string, Term[]>();
  for (const t of glossary) {
    const arr = byCat.get(t.category) ?? [];
    arr.push(t);
    byCat.set(t.category, arr);
  }
  const lines: string[] = ["## Dizionario tecnico ZATO (gergo di cantiere → termine corretto)"];
  for (const [cat, terms] of [...byCat.entries()].sort()) {
    lines.push(`### ${cat}`);
    for (const t of terms) {
      const alias = t.aliases.length ? ` (anche: ${t.aliases.join(", ")})` : "";
      const def = t.definition ? ` — ${t.definition}` : "";
      lines.push(`- **${t.term}**${alias}${def}`);
    }
  }
  return lines.join("\n");
}
