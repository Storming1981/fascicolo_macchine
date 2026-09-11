import crypto from "crypto";
import { prisma } from "@/lib/db";
import { estimateCostUsd } from "./config";
import type { UsedSource, Citation } from "./ask";

/**
 * Cache delle risposte.
 *
 * La prompt cache di Anthropic abbatte il costo del system prompt, ma non
 * quello dei documenti recuperati né della generazione: una stessa domanda
 * ripetuta costa ogni volta quasi come la prima. In un portale clienti le
 * domande si ripetono parecchio ("ogni quanto cambio l'olio", "come si accende")
 * e la seconda in poi può costare zero.
 *
 * Due regole che tengono la cache onesta:
 *  - la chiave include la **versione della knowledge base**: appena si carica o
 *    reindicizza un documento tutte le risposte decadono da sole, senza doverle
 *    invalidare a mano;
 *  - si mette in cache **solo la prima domanda di una conversazione**. Un
 *    "e i guanti che tipo devono essere?" dipende da quello che c'era prima:
 *    riusarlo per un altro utente darebbe una risposta a caso.
 */

/** Cambia a ogni caricamento/reindicizzazione: fa decadere tutta la cache. */
export async function knowledgeVersion(): Promise<string> {
  const r = await prisma.knowledgeSource.aggregate({
    where: { status: "READY" },
    _max: { indexedAt: true },
    _count: { _all: true },
  });
  return `${r._count._all}:${r._max.indexedAt?.getTime() ?? 0}`;
}

/** Normalizza la domanda: maiuscole, punteggiatura e spazi non contano. */
function normalize(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type CacheScope = {
  audience: "internal" | "portal";
  customerId?: string | null;
  plantType?: string | null;
  machineId?: string | null;
};

export function cacheKey(question: string, scope: CacheScope, version: string): string {
  const parts = [
    normalize(question),
    scope.audience,
    scope.customerId ?? "",
    scope.plantType ?? "",
    scope.machineId ?? "",
    version,
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export type CachedAnswer = {
  answer: string;
  sources: UsedSource[];
  citations: Citation[];
  model: string | null;
  savedUsd: number;
};

/** Cerca una risposta già data. `null` se non c'è (o se non è riutilizzabile). */
export async function lookupAnswer(
  question: string,
  scope: CacheScope,
  opts: { hasHistory: boolean; hasImages: boolean }
): Promise<CachedAnswer | null> {
  // Una domanda di follow-up dipende dalla conversazione, e un'immagine allegata
  // cambia tutto: né l'una né l'altra sono riutilizzabili.
  if (opts.hasHistory || opts.hasImages) return null;

  const key = cacheKey(question, scope, await knowledgeVersion());
  const row = await prisma.brainAnswerCache.findUnique({ where: { key } });
  if (!row) return null;

  await prisma.brainAnswerCache.update({
    where: { key },
    data: { hits: { increment: 1 }, lastUsedAt: new Date() },
  });

  return {
    answer: row.answer,
    sources: (row.sources as unknown as UsedSource[]) ?? [],
    citations: (row.citations as unknown as Citation[]) ?? [],
    model: row.model,
    savedUsd: row.savedUsd,
  };
}

/** Memorizza una risposta appena generata. Gli errori non devono bloccare nulla. */
export async function storeAnswer(args: {
  question: string;
  scope: CacheScope;
  answer: string;
  sources: UsedSource[];
  citations: Citation[];
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  hasHistory: boolean;
  hasImages: boolean;
}): Promise<void> {
  if (args.hasHistory || args.hasImages) return;
  if (args.answer.trim().length < 40) return; // errori e risposte vuote: non vale

  try {
    const key = cacheKey(args.question, args.scope, await knowledgeVersion());
    const savedUsd = estimateCostUsd(args.model, args.usage);
    await prisma.brainAnswerCache.upsert({
      where: { key },
      create: {
        key,
        question: args.question.slice(0, 500),
        answer: args.answer,
        sources: args.sources as unknown as object,
        citations: args.citations as unknown as object,
        scope: args.scope.audience,
        model: args.model,
        savedUsd,
      },
      update: { answer: args.answer, sources: args.sources as unknown as object, savedUsd },
    });
  } catch {
    /* la cache è un'ottimizzazione: se fallisce, pazienza */
  }
}

/** Quanto ha fatto risparmiare finora (per la scheda Documenti). */
export async function cacheStats(): Promise<{ entries: number; hits: number; savedUsd: number }> {
  const r = await prisma.brainAnswerCache.aggregate({
    _count: { _all: true },
    _sum: { hits: true },
  });
  const rows = await prisma.brainAnswerCache.findMany({ select: { hits: true, savedUsd: true } });
  return {
    entries: r._count._all,
    hits: r._sum.hits ?? 0,
    savedUsd: rows.reduce((s, x) => s + x.hits * x.savedUsd, 0),
  };
}
