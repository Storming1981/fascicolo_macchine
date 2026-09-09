
/**
 * Configurazione dello ZATO Brain.
 *
 * Due modelli, due ruoli — è la scelta che tiene basso il costo senza perdere
 * qualità nelle risposte:
 *  - ANSWER  (Opus 5): risponde al tecnico/cliente citando la documentazione.
 *  - UTILITY (Haiku 4.5): lavoro sporco ad alto volume — espansione della query,
 *    descrizione dei disegni tecnici, OCR delle pagine scansionate, titoli.
 */
export const ANSWER_MODEL = process.env.BRAIN_ANSWER_MODEL || "claude-opus-5";
export const UTILITY_MODEL = process.env.BRAIN_UTILITY_MODEL || "claude-haiku-4-5-20251001";

export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export function apiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null;
}

export function isBrainConfigured(): boolean {
  return Boolean(apiKey());
}

/** Parametri di indicizzazione e retrieval (tarati su documentazione tecnica). */
export const INDEX = {
  /** Caratteri per chunk (~450 token): un paragrafo tecnico completo. */
  chunkChars: 1800,
  /** Sovrapposizione fra chunk consecutivi: evita di tagliare una procedura a metà. */
  overlapChars: 220,
  /** Sotto questa soglia di testo per pagina il PDF è considerato scansionato. */
  minCharsPerPage: 90,
  /** Pagine per chiamata di OCR AI (batch: meno richieste, meno overhead). */
  ocrPagesPerCall: 5,
  /** Tetto di pagine su cui fare OCR automatico (oltre serve conferma esplicita). */
  ocrMaxPages: 40,
};

export const RETRIEVAL = {
  /** Chunk passati al modello nella risposta finale. */
  topK: 12,
  /** Candidati estratti dal DB prima del ranking. */
  candidates: 60,
  /** Massimo di chunk dalla stessa fonte: forza la diversità delle fonti. */
  maxPerSource: 3,
  /** Punteggio minimo per considerare un chunk pertinente. */
  minScore: 0.02,
};

/** Stima token grossolana ma stabile per l'italiano tecnico (~4 char/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Costo indicativo in euro, per mostrare all'utente quanto spende il Brain. */
const PRICES: Record<string, { in: number; out: number; cached: number }> = {
  "claude-opus-5": { in: 5, out: 25, cached: 0.5 },
  "claude-sonnet-5": { in: 2, out: 10, cached: 0.2 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5, cached: 0.1 },
};

export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  return (
    (usage.inputTokens / 1e6) * p.in +
    (usage.outputTokens / 1e6) * p.out +
    ((usage.cacheReadTokens ?? 0) / 1e6) * p.cached
  );
}
