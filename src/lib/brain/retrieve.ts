import { Prisma, type KnowledgeSourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RETRIEVAL, UTILITY_MODEL } from "./config";
import { anthropic } from "./client";
import { expandWithGlossary, loadGlossary, type Term } from "./glossary";

export type Passage = {
  chunkId: string;
  sourceId: string;
  seq: number;
  breadcrumb: string;
  page: number | null;
  videoAt: number | null;
  text: string;
  tokens: number;
  score: number;
  source: {
    id: string;
    title: string;
    type: KnowledgeSourceType;
    filePath: string | null;
    videoUrl: string | null;
    posterPath: string | null;
    plantType: string | null;
    model: string | null;
    updatedAt: Date;
  };
};

export type RetrievalScope = {
  /** portal = solo fonti con visibility CUSTOMER, filtrate sul cliente. */
  audience: "internal" | "portal";
  customerId?: string | null;
  plantType?: string | null;
  model?: string | null;
  machineId?: string | null;
  /** Limita la ricerca ad alcuni tipi di fonte (es. solo VIDEO). */
  types?: KnowledgeSourceType[];
};

/**
 * Priorità per tipo di fonte. Un manuale ufficiale batte una chat di cantiere:
 * senza questo boost le conversazioni (che sono tantissime) soffocano la
 * documentazione ufficiale nelle risposte.
 */
const TYPE_BOOST: Record<KnowledgeSourceType, number> = {
  MANUAL: 1.35,
  PROCEDURE: 1.35,
  BULLETIN: 1.25,
  CASE: 1.2,
  DRAWING: 1.15,
  SPARE: 1.15,
  VIDEO: 1.15,
  ARTICLE: 1.1,
  RAPPORTINO: 1.0,
  DIARY: 0.95,
  CHAT: 0.85,
  OTHER: 0.9,
};

/* ───────────────────── Espansione della domanda ───────────────────── */

export type QueryPlan = {
  /** Riformulazioni della domanda usate per la ricerca (recall). */
  queries: string[];
  /** Termini canonici estratti dal dizionario. */
  glossaryTerms: string[];
  plantType: string | null;
  model: string | null;
  /** true quando la domanda non riguarda la documentazione tecnica. */
  smallTalk: boolean;
};

/**
 * Trasforma la domanda in un piano di ricerca. Prima il dizionario (gratuito e
 * deterministico), poi Haiku per le riformulazioni: costa qualche centesimo di
 * millesimo e alza parecchio la recall su un corpus tecnico in italiano.
 */
export async function planQuery(
  question: string,
  history: { role: string; content: string }[],
  glossary?: Term[]
): Promise<QueryPlan> {
  const gloss = glossary ?? (await loadGlossary());
  // Del dizionario serve il termine CANONICO, non gli alias. Gli alias servono a
  // riconoscere il gergo nella domanda ("accendere"), ma trasformarli tutti in
  // query separate fa più danno che bene: cercando anche "avviamento",
  // "far partire", "dare tensione" si tirava dentro il capitolo "5.7 PRIMO
  // AVVIAMENTO" (che è tutt'altro: la messa in servizio a cura del costruttore)
  // e si diluiva il punteggio della sezione giusta, "6.2.1 Accensione".
  const { matched } = expandWithGlossary(question, gloss);
  const terms = matched.map((m) => m.term);
  const base: QueryPlan = {
    queries: [question],
    glossaryTerms: terms,
    plantType: null,
    model: null,
    smallTalk: false,
  };

  const client = anthropic();
  if (!client) return base;

  const recent = history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "UTENTE" : "BRAIN"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  try {
    const res = await client.messages.create({
      model: UTILITY_MODEL,
      max_tokens: 700,
      system:
        "Prepari la ricerca documentale per l'assistenza tecnica ZATO (impianti di triturazione " +
        "e selezione rottami ferrosi: BLUE DEVIL, BLUE SHARK, BLUE SORTER, BLUE MARLIN, BLUE STORM, " +
        "CESOIE CAYMAN, SPACCABINARI). Dalla domanda dell'operatore ricavi le chiavi di ricerca da " +
        "usare su manuali, procedure, rapportini di cantiere e chat. Non rispondi alla domanda.",
      tools: [
        {
          name: "piano",
          description: "Piano di ricerca sulla knowledge base ZATO.",
          input_schema: {
            type: "object",
            properties: {
              queries: {
                type: "array",
                items: { type: "string" },
                description:
                  "2-4 riformulazioni della domanda con il lessico dei manuali tecnici. " +
                  "Includi sinonimi, nomi dei componenti e codici/allarmi citati. " +
                  "Se la domanda fa riferimento al contesto precedente, esplicitalo. " +
                  "NON aggiungere il nome della macchina o della tipologia di impianto " +
                  "(BLUE DEVIL, CAYMAN…): quello si filtra a parte, e dentro i capitoli " +
                  "il nome del prodotto non compare quasi mai. " +
                  "Usa i sostantivi dei titoli di capitolo, non i verbi della domanda " +
                  "(il manuale scrive 'accensione', non 'accendere').",
              },
              plantType: {
                type: "string",
                description:
                  "Tipologia impianto citata, esatta fra BLUE DEVIL, BLUE SHARK, BLUE SORTER, " +
                  "BLUE MARLIN, BLUE STORM, CESOIE, SPACCABINARI. Ometti se non citata.",
              },
              model: { type: "string", description: "Modello citato (es. MULINO 16-13, CAYMAN 40). Ometti se assente." },
              smallTalk: {
                type: "boolean",
                description: "true solo se è un saluto o una domanda non tecnica che non richiede documentazione.",
              },
            },
            required: ["queries", "smallTalk"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "piano" },
      messages: [
        {
          role: "user",
          content: `${recent ? `Conversazione:\n${recent}\n\n` : ""}Domanda: ${question}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return base;
    const input = block.input as Partial<QueryPlan>;
    const queries = Array.isArray(input.queries) ? input.queries.map(String).filter(Boolean) : [];
    return {
      queries: [question, ...queries].slice(0, 5),
      glossaryTerms: terms,
      plantType: typeof input.plantType === "string" ? input.plantType : null,
      model: typeof input.model === "string" ? input.model : null,
      smallTalk: Boolean(input.smallTalk),
    };
  } catch {
    return base; // l'AI non deve mai bloccare la ricerca: si va di full-text puro
  }
}

/* ───────────────────────── Ricerca ───────────────────────── */

type Row = {
  id: string;
  sourceId: string;
  seq: number;
  breadcrumb: string;
  page: number | null;
  videoAt: number | null;
  text: string;
  tokens: number;
  rank: number;
  /** true se la parola cercata compare nel titolo di sezione del frammento. */
  titleHit: boolean;
};

/**
 * Una passata di full-text sui chunk. `websearch_to_tsquery` accetta linguaggio
 * naturale senza esplodere sugli operatori, e `ts_rank_cd` premia i chunk in cui
 * i termini della domanda sono vicini fra loro.
 */
async function searchOnce(query: string, scope: RetrievalScope, limit: number): Promise<Row[]> {
  const q = query.trim();
  if (!q) return [];

  const filters: Prisma.Sql[] = [Prisma.sql`s."status" = 'READY'`];
  if (scope.audience === "portal") {
    filters.push(Prisma.sql`s."visibility" = 'CUSTOMER'`);
    // Nel portale il cliente vede solo le fonti generiche o le proprie.
    filters.push(
      scope.customerId
        ? Prisma.sql`(s."customerId" IS NULL OR s."customerId" = ${scope.customerId})`
        : Prisma.sql`s."customerId" IS NULL`
    );
  }
  if (scope.types?.length)
    filters.push(
      Prisma.sql`s."type"::text IN (${Prisma.join(scope.types.map((t) => Prisma.sql`${t}`))})`
    );

  const where = Prisma.join(filters, " AND ");
  const or = orQuery(q);

  // Due passate INSIEME, non una in ripiego dell'altra.
  //
  // `websearch_to_tsquery` mette i termini in AND: preciso, ma una domanda
  // scritta per esteso non trova quasi mai nulla ("quali controlli preliminare
  // devo fare prima di avviare un Blue Devil" → zero frammenti, perché nessun
  // capitolo contiene tutte quelle parole). Facendo scattare l'OR solo quando
  // l'AND era a vuoto, la sezione giusta arrivava penalizzata del 40% e finiva
  // sotto a tabelle di manutenzione che ripetono una delle parole: Postgres non
  // pesa i termini rari, quindi "controlli" ripetuto dieci volte batte
  // "Controlli preliminari" detto una volta al punto giusto.
  //
  // Si prende quindi il meglio delle due (l'AND resta il segnale forte) e si
  // segnala a parte se la parola cercata sta nel TITOLO della sezione: quando
  // uno chiede "i controlli preliminari" intende il capitolo che si chiama
  // così, ed è il segnale più affidabile che abbiamo.
  const loose = or ? Prisma.sql`to_tsquery('italian', ${or})` : Prisma.sql`websearch_to_tsquery('italian', ${q})`;

  return prisma.$queryRaw<Row[]>`
    SELECT c."id", c."sourceId", c."seq", c."breadcrumb", c."page", c."videoAt",
           c."text", c."tokens",
           GREATEST(
             ts_rank_cd(c."tsv", websearch_to_tsquery('italian', ${q}), 32),
             ts_rank_cd(c."tsv", ${loose}, 32) * 0.6
           ) AS rank,
           (to_tsvector('italian', c."breadcrumb") @@ ${loose}) AS "titleHit"
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE ${where}
      AND (c."tsv" @@ websearch_to_tsquery('italian', ${q}) OR c."tsv" @@ ${loose})
    ORDER BY rank DESC
    LIMIT ${limit}`;
}

/** Parole significative della domanda unite in OR, in sintassi to_tsquery. */
function orQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 10);
  return words.length ? [...new Set(words)].join(" | ") : null;
}

/** Parole troppo comuni per discriminare: allargherebbero solo il rumore. */
const STOPWORDS = new Set([
  "che", "con", "come", "cosa", "del", "della", "delle", "dei", "degli", "dal", "dalla",
  "per", "non", "una", "uno", "gli", "sul", "sulla", "nel", "nella", "quando", "quale",
  "quali", "quanto", "quante", "dove", "posso", "devo", "fare", "sono", "essere", "ogni",
  "the", "and", "for", "with",
]);

/**
 * Recupera i passaggi pertinenti.
 *
 * Unisce i risultati di tutte le riformulazioni (un chunk trovato da più query
 * è più affidabile), applica i boost di contesto e limita quanti chunk può
 * portare la stessa fonte: meglio quattro documenti diversi che quattro pagine
 * consecutive dello stesso manuale.
 */
export async function retrieve(plan: QueryPlan, scope: RetrievalScope): Promise<Passage[]> {
  const queries = [...new Set([...plan.queries, ...plan.glossaryTerms.slice(0, 6)])].filter(Boolean);
  const perQuery = Math.max(10, Math.ceil(RETRIEVAL.candidates / Math.max(1, queries.length)));

  const results = await Promise.all(queries.map((q) => searchOnce(q, scope, perQuery)));

  // Fusione: somma dei rank con peso decrescente per le riformulazioni, più un
  // bonus per i chunk trovati da query diverse.
  const acc = new Map<string, { row: Row; score: number; hits: number; title: boolean }>();
  results.forEach((rows, qi) => {
    const weight = qi === 0 ? 1 : 0.8; // la domanda originale pesa di più
    for (const row of rows) {
      const cur = acc.get(row.id);
      if (cur) {
        cur.score += row.rank * weight;
        cur.hits++;
        cur.title = cur.title || row.titleHit;
      } else {
        acc.set(row.id, { row, score: row.rank * weight, hits: 1, title: row.titleHit });
      }
    }
  });
  if (acc.size === 0) return [];

  const sources = await prisma.knowledgeSource.findMany({
    where: { id: { in: [...new Set([...acc.values()].map((a) => a.row.sourceId))] } },
    select: {
      id: true,
      title: true,
      type: true,
      filePath: true,
      videoUrl: true,
      posterPath: true,
      plantType: true,
      model: true,
      machineId: true,
      updatedAt: true,
    },
  });
  const byId = new Map(sources.map((s) => [s.id, s]));

  const now = Date.now();
  const scored: Passage[] = [];
  for (const { row, score, hits, title } of acc.values()) {
    const s = byId.get(row.sourceId);
    if (!s) continue;

    let boost = TYPE_BOOST[s.type] ?? 1;
    // Il titolo di sezione e' il segnale piu' affidabile: chi chiede "i controlli
    // preliminari" vuole il capitolo che si chiama cosi', non la tabella di
    // manutenzione che ripete la parola "controlli".
    if (title) boost *= 1.8;
    boost *= 1 + Math.min(hits - 1, 3) * 0.12; // trovato da più riformulazioni
    if (plan.plantType && s.plantType === plan.plantType) boost *= 1.3;
    if (scope.plantType && s.plantType === scope.plantType) boost *= 1.25;
    if (plan.model && s.model === plan.model) boost *= 1.2;
    if (scope.machineId && s.machineId === scope.machineId) boost *= 1.4; // fascicolo esatto
    // I contenuti operativi invecchiano: una chat di 4 anni fa conta meno di
    // quella del mese scorso. I manuali no, restano validi.
    if (s.type === "CHAT" || s.type === "RAPPORTINO" || s.type === "DIARY") {
      const years = (now - s.updatedAt.getTime()) / (365 * 24 * 3600 * 1000);
      boost *= Math.max(0.6, 1 - years * 0.08);
    }

    scored.push({
      chunkId: row.id,
      sourceId: row.sourceId,
      seq: row.seq,
      breadcrumb: row.breadcrumb,
      page: row.page,
      videoAt: row.videoAt,
      text: row.text,
      tokens: row.tokens,
      score: score * boost,
      source: {
        id: s.id,
        title: s.title,
        type: s.type,
        filePath: s.filePath,
        videoUrl: s.videoUrl,
        posterPath: s.posterPath,
        plantType: s.plantType,
        model: s.model,
        updatedAt: s.updatedAt,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const max = scored[0]?.score ?? 1;

  const perSource = new Map<string, number>();
  const out: Passage[] = [];
  for (const p of scored) {
    if (p.score / max < RETRIEVAL.minScore) break;
    const n = perSource.get(p.sourceId) ?? 0;
    if (n >= RETRIEVAL.maxPerSource) continue;
    perSource.set(p.sourceId, n + 1);
    out.push({ ...p, score: p.score / max });
    if (out.length >= RETRIEVAL.topK) break;
  }
  return out;
}

/** Ricerca diretta (barra di ricerca della Knowledge), senza passare dall'AI. */
export async function searchKnowledge(
  query: string,
  scope: RetrievalScope,
  limit = 20
): Promise<Passage[]> {
  const glossary = await loadGlossary();
  const { matched } = expandWithGlossary(query, glossary);
  return retrieve(
    {
      queries: [query],
      glossaryTerms: matched.map((m) => m.term).slice(0, 4),
      plantType: null,
      model: null,
      smallTalk: false,
    },
    scope
  ).then((r) => r.slice(0, limit));
}
