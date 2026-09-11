import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { requireAnthropic } from "./client";
import { ANSWER_MODEL, estimateCostUsd } from "./config";
import { glossaryPrompt, loadGlossary } from "./glossary";
import { planQuery, retrieve, type Passage, type RetrievalScope } from "./retrieve";
import { PLANT_TYPES } from "@/lib/plant";

export type AskImage = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

export type AskInput = {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  scope: RetrievalScope;
  images?: AskImage[];
  /** Contesto operativo: macchina/cliente/intervento da cui parte la domanda. */
  context?: string | null;
};

export type UsedSource = {
  sourceId: string;
  title: string;
  type: string;
  breadcrumb: string;
  page: number | null;
  videoAt: number | null;
  filePath: string | null;
  videoUrl: string | null;
  score: number;
};

export type Citation = { text: string; sourceId: string; title: string; page: number | null };

export type AskEvent =
  | { type: "status"; message: string }
  | { type: "sources"; sources: UsedSource[] }
  | { type: "text"; delta: string }
  | { type: "citation"; citation: Citation }
  | {
      type: "done";
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
      costUsd: number;
      model: string;
      latencyMs: number;
    }
  | { type: "error"; message: string };

/* ─────────────────────────── System prompt ─────────────────────────── */

/**
 * Il system prompt è lungo (regole + dizionario completo) ma IDENTICO a ogni
 * domanda: sta in prompt cache, quindi si paga a tariffa piena una volta e poi
 * al 10%. Per questo il dizionario può permettersi di essere generoso.
 */
async function buildSystem(audience: "internal" | "portal"): Promise<string> {
  const glossary = await loadGlossary();
  const rules =
    audience === "portal"
      ? [
          "Parli con un CLIENTE ZATO dal portale. Tono professionale e cortese, dai del Lei.",
          "Non citare mai margini, costi interni, nomi di fornitori, o informazioni su altri clienti.",
          "Per operazioni che richiedono personale qualificato, indica di aprire una richiesta di assistenza.",
        ]
      : [
          "Parli con un tecnico o un operatore ZATO. Tono diretto e concreto, come un collega esperto.",
          "Puoi citare rapportini, interventi passati e conversazioni di cantiere interne.",
        ];

  return [
    "# ZATO Brain",
    "",
    "Sei l'assistente tecnico di ZATO, costruttore di impianti per il trattamento dei rottami",
    "ferrosi: trituratori BLUE DEVIL e BLUE SHARK, linee di selezione BLUE SORTER, BLUE MARLIN,",
    "BLUE STORM, cesoie CAYMAN e spaccabinari. Rispondi a domande su installazione, uso,",
    "manutenzione, guasti, ricambi e procedure.",
    "",
    `Tipologie di impianto a catalogo: ${PLANT_TYPES.join(", ")}.`,
    "",
    "## Come devi rispondere",
    ...rules.map((r) => `- ${r}`),
    "- Rispondi SEMPRE in italiano.",
    "- Fondati sui DOCUMENTI forniti nel messaggio. Non inventare procedure, valori di taratura,",
    "  codici ricambio o coppie di serraggio: se un dato non è nei documenti, dillo chiaramente.",
    "- Se i documenti non bastano, dichiaralo in una riga e spiega cosa serve per rispondere",
    "  (quale manuale, quale foto, quale numero di matricola), invece di tirare a indovinare.",
    "- Struttura le procedure come elenchi numerati di passi operativi verificabili.",
    "- Quando i documenti mostrano che un problema si è già ripetuto su più macchine, dillo:",
    "  è l'informazione più utile per evitare che ricapiti.",
    "- Se sono presenti video di procedura pertinenti, segnalali indicando il minuto utile.",
    "",
    "## Sicurezza — non negoziabile",
    "- Prima di qualsiasi intervento su organi in movimento o su parti in tensione, ricorda il",
    "  sezionamento delle energie (LOTO) e i DPI previsti.",
    "- Non suggerire mai di escludere protezioni, ripari, finecorsa o funghi di emergenza.",
    "- Le lavorazioni sull'impianto in tensione o in pressione sono riservate a personale",
    "  qualificato: dillo esplicitamente quando la domanda le riguarda.",
    "",
    glossaryPrompt(glossary),
  ]
    .filter(Boolean)
    .join("\n");
}

/* ───────────────────────── Documenti per il modello ───────────────────────── */

const TYPE_LABEL: Record<string, string> = {
  MANUAL: "Manuale ufficiale",
  PROCEDURE: "Procedura standard",
  CASE: "Caso risolto",
  DRAWING: "Disegno tecnico",
  VIDEO: "Video procedura",
  BULLETIN: "Bollettino tecnico",
  SPARE: "Ricambi",
  ARTICLE: "Articolo interno",
  RAPPORTINO: "Rapportino di cantiere",
  CHAT: "Conversazione di cantiere",
  DIARY: "Diario macchina",
  OTHER: "Documento",
};

/**
 * Ogni passaggio diventa un `document` con le citazioni attive: Claude cita la
 * porzione esatta di testo su cui si basa, e la UI può linkare il PDF alla
 * pagina giusta. È ciò che rende la risposta verificabile invece che opaca.
 */
function toDocuments(passages: Passage[]): Anthropic.DocumentBlockParam[] {
  return passages.map((p) => {
    const meta = [TYPE_LABEL[p.source.type] ?? "Documento"];
    if (p.source.plantType) meta.push(p.source.plantType);
    if (p.source.model) meta.push(p.source.model);
    if (p.page) meta.push(`pagina ${p.page}`);
    if (p.videoAt != null) meta.push(`minuto ${Math.floor(p.videoAt / 60)}:${String(p.videoAt % 60).padStart(2, "0")}`);
    return {
      type: "document",
      title: p.breadcrumb.slice(0, 200),
      context: meta.join(" · "),
      source: { type: "content", content: [{ type: "text", text: p.text }] },
      citations: { enabled: true },
    };
  });
}

/* ─────────────────────────── Domanda ─────────────────────────── */

/**
 * Esegue una domanda al Brain e restituisce gli eventi in streaming.
 *
 * Flusso: piano di ricerca (Haiku) → retrieval sui chunk → risposta (Opus) sui
 * soli passaggi pertinenti. Il documento originale non viene mai rispedito al
 * modello: è quello che tiene il costo per domanda nell'ordine dei centesimi.
 */
export async function* askBrain(input: AskInput): AsyncGenerator<AskEvent> {
  const started = Date.now();
  const client = requireAnthropic();
  const audience = input.scope.audience;

  yield { type: "status", message: "Interpreto la domanda…" };
  const glossary = await loadGlossary();
  const plan = await planQuery(input.question, input.history, glossary);

  yield { type: "status", message: "Cerco nella documentazione ZATO…" };
  const passages = plan.smallTalk ? [] : await retrieve(plan, input.scope);

  const used: UsedSource[] = passages.map((p) => ({
    sourceId: p.sourceId,
    title: p.source.title,
    type: p.source.type,
    breadcrumb: p.breadcrumb,
    page: p.page,
    videoAt: p.videoAt,
    filePath: p.source.filePath,
    videoUrl: p.source.videoUrl,
    score: Math.round(p.score * 100) / 100,
  }));
  yield { type: "sources", sources: used };

  const system = await buildSystem(audience);

  // Storia: solo testo, i documenti si riagganciano freschi a ogni turno.
  const messages: Anthropic.MessageParam[] = input.history
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  const userContent: Anthropic.ContentBlockParam[] = [];
  for (const img of input.images ?? []) {
    userContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  }
  userContent.push(...toDocuments(passages));
  if (passages.length === 0 && !plan.smallTalk) {
    userContent.push({
      type: "text",
      text:
        "NESSUN DOCUMENTO PERTINENTE trovato nella knowledge base. Dillo con onestà, " +
        "spiega quale documentazione servirebbe e — se la domanda è tecnica generale — " +
        "dai al massimo un orientamento prudente, segnalando che non è tratto dai manuali ZATO.",
    });
  }
  if (input.context) userContent.push({ type: "text", text: `Contesto operativo: ${input.context}` });
  if ((input.images?.length ?? 0) > 0)
    userContent.push({
      type: "text",
      text:
        "L'utente ha allegato una o più immagini (foto del guasto, targhetta o disegno tecnico). " +
        "Leggile e usale per rispondere: componenti, sigle, codici, anomalie visibili.",
    });
  userContent.push({ type: "text", text: input.question });
  messages.push({ role: "user", content: userContent });

  yield { type: "status", message: "Elaboro la risposta…" };

  const seen = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  try {
    const stream = client.messages.stream({
      model: ANSWER_MODEL,
      max_tokens: 4000,
      // Il system prompt (regole + dizionario intero) è stabile e vale ~4k token.
      // TTL di un'ora invece dei 5 minuti di default: fra una domanda e l'altra
      // passano minuti, non secondi, e con la finestra corta metà delle richieste
      // pagava il prefisso a prezzo pieno (misurato: 12 risposte su 26 senza un
      // solo token letto da cache). La scrittura costa 2x invece di 1.25x, e si
      // ripaga alla prima lettura evitata.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", delta: event.delta.text };
        } else if (event.delta.type === "citations_delta") {
          const c = event.delta.citation;
          const title = "document_title" in c ? (c.document_title ?? "") : "";
          const idx = "document_index" in c ? c.document_index : -1;
          const p = passages[idx];
          const cited = "cited_text" in c ? c.cited_text : "";
          const key = `${idx}|${cited.slice(0, 60)}`;
          if (p && !seen.has(key)) {
            seen.add(key);
            yield {
              type: "citation",
              citation: { text: cited, sourceId: p.sourceId, title: title || p.breadcrumb, page: p.page },
            };
          }
        }
      } else if (event.type === "message_delta") {
        usage.outputTokens = event.usage.output_tokens ?? usage.outputTokens;
      } else if (event.type === "message_start") {
        usage.inputTokens = event.message.usage.input_tokens ?? 0;
        usage.cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens = event.message.usage.cache_creation_input_tokens ?? 0;
      }
    }
    await stream.done();

    yield {
      type: "done",
      usage,
      costUsd: estimateCostUsd(ANSWER_MODEL, usage),
      model: ANSWER_MODEL,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    const { aiErrorMessage } = await import("./client");
    yield { type: "error", message: aiErrorMessage(e) };
  }
}

/** Titolo breve per la conversazione, dalla prima domanda. */
export async function titleFor(question: string): Promise<string> {
  const q = question.trim().replace(/\s+/g, " ");
  return q.length <= 60 ? q : q.slice(0, 57) + "…";
}
