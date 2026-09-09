import crypto from "crypto";
import type { KnowledgeSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { chunkPages, chunkTranscript, type Chunk } from "./chunk";
import { extractFile } from "./extract";
import { estimateTokens } from "./config";

/**
 * Indicizzazione: da sorgente a chunk cercabili.
 *
 * Il testo viene estratto UNA SOLA VOLTA qui. A runtime il modello riceve solo
 * i chunk pertinenti: un manuale da 300 pagine (~400k token) costerebbe una
 * fortuna a ogni domanda, i suoi 12 chunk rilevanti costano ~5k token.
 */

function hash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Scrive i chunk e popola il vettore full-text italiano. Il breadcrumb entra nel
 * tsvector con peso A: cercando "cambio lame" pesano di più i chunk della
 * sezione "Cambio lame" che quelli che la citano di sfuggita.
 */
async function writeChunks(sourceId: string, chunks: Chunk[]): Promise<void> {
  await prisma.knowledgeChunk.deleteMany({ where: { sourceId } });
  if (chunks.length === 0) return;

  // A blocchi: un manuale può produrre migliaia di chunk e i parametri di una
  // singola query Postgres sono limitati.
  const BATCH = 200;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    await prisma.$executeRaw`
      INSERT INTO "KnowledgeChunk"
        ("id","sourceId","seq","breadcrumb","heading","page","text","tokens","videoAt","createdAt","tsv")
      SELECT
        d."id", d."sourceId", d."seq", d."breadcrumb", d."heading", d."page",
        d."text", d."tokens", d."videoAt", NOW(),
        setweight(to_tsvector('italian', d."breadcrumb"), 'A') ||
        setweight(to_tsvector('italian', d."text"), 'B')
      FROM jsonb_to_recordset(${JSON.stringify(
        batch.map((c) => ({
          id: crypto.randomUUID(),
          sourceId,
          seq: c.seq,
          breadcrumb: c.breadcrumb,
          heading: c.heading,
          page: c.page,
          text: c.text,
          tokens: c.tokens,
          videoAt: c.videoAt,
        }))
      )}::jsonb) AS d(
        "id" text, "sourceId" text, "seq" int, "breadcrumb" text, "heading" text,
        "page" int, "text" text, "tokens" int, "videoAt" int
      )`;
  }
}

export type IndexResult = {
  ok: boolean;
  chunks: number;
  chars: number;
  tokens: number;
  ocrUsed: boolean;
  note?: string;
  error?: string;
  /** true se il contenuto non è cambiato e l'indice è stato lasciato com'era. */
  unchanged?: boolean;
};

/**
 * (Ri)indicizza una sorgente. È idempotente: se il testo estratto non è
 * cambiato (stesso hash) non tocca i chunk, così un "reindicizza tutto" su
 * centinaia di documenti non rifà lavoro inutile.
 */
export async function indexSource(sourceId: string, opts: { force?: boolean } = {}): Promise<IndexResult> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return { ok: false, chunks: 0, chars: 0, tokens: 0, ocrUsed: false, error: "Sorgente non trovata" };

  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { status: "PROCESSING", error: null },
  });

  try {
    const { chunks, chars, ocrUsed, note, pageCount } = await buildChunks(source);
    const contentHash = hash(chunks.map((c) => c.text).join("\n"));

    if (!opts.force && source.contentHash === contentHash && source.status === "READY") {
      await prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status: "READY" } });
      return {
        ok: true,
        chunks: source.chunkCount,
        chars: source.extractedChars,
        tokens: source.tokensEstimate,
        ocrUsed: source.ocrUsed,
        unchanged: true,
      };
    }

    await writeChunks(sourceId, chunks);
    const tokens = chunks.reduce((s, c) => s + c.tokens, 0);
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: chunks.length > 0 ? "READY" : "FAILED",
        error: chunks.length > 0 ? null : "Nessun testo indicizzabile estratto dal documento",
        contentHash,
        extractedChars: chars,
        chunkCount: chunks.length,
        tokensEstimate: tokens,
        ocrUsed,
        pageCount: pageCount ?? source.pageCount,
        indexedAt: new Date(),
      },
    });
    return { ok: chunks.length > 0, chunks: chunks.length, chars, tokens, ocrUsed, note };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Errore di indicizzazione";
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "FAILED", error: error.slice(0, 500) },
    });
    return { ok: false, chunks: 0, chars: 0, tokens: 0, ocrUsed: false, error };
  }
}

/** Produce i chunk a partire dal tipo di sorgente (file, video, testo libero). */
async function buildChunks(source: KnowledgeSource): Promise<{
  chunks: Chunk[];
  chars: number;
  ocrUsed: boolean;
  note?: string;
  pageCount?: number;
}> {
  // Video: si indicizza la scheda (titolo + descrizione + trascrizione con
  // timestamp). Il filmato non passa mai dal modello, viene proposto come risorsa.
  if (source.type === "VIDEO") {
    const head = [source.title, source.description ?? ""].filter(Boolean).join("\n\n");
    const chunks = chunkTranscript(source.description ?? "", source.title);
    const all = chunks.length
      ? chunks
      : [
          {
            seq: 0,
            breadcrumb: source.title,
            heading: null,
            page: null,
            text: head,
            tokens: estimateTokens(head),
            videoAt: null,
          },
        ];
    return { chunks: all, chars: head.length, ocrUsed: false };
  }

  if (source.filePath && source.mimeType) {
    const ex = await extractFile(source.filePath, source.mimeType, {
      title: source.title,
      plantType: source.plantType,
      model: source.model,
    });
    // La descrizione manuale è conoscenza aggiunta dall'operatore: entra come
    // primo chunk, non va persa.
    const pages = source.description?.trim()
      ? [{ page: 1, text: `${source.title}\n${source.description.trim()}` }, ...ex.pages]
      : ex.pages;
    const chunks = chunkPages(pages, source.title);
    return {
      chunks,
      chars: ex.pages.reduce((s, p) => s + p.text.length, 0),
      ocrUsed: ex.ocrUsed,
      note: ex.note,
      pageCount: ex.pageCount,
    };
  }

  // Sorgente di solo testo (articolo, procedura scritta a mano, derivati).
  const text = source.description ?? "";
  return {
    chunks: chunkPages([{ page: 1, text }], source.title),
    chars: text.length,
    ocrUsed: false,
  };
}

/** Indicizza in serie tutte le sorgenti che ne hanno bisogno. */
export async function indexPending(limit = 50): Promise<{ done: number; failed: number }> {
  const pending = await prisma.knowledgeSource.findMany({
    where: { status: { in: ["PENDING", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  let failed = 0;
  for (const s of pending) {
    const r = await indexSource(s.id);
    if (r.ok) done++;
    else failed++;
  }
  return { done, failed };
}
