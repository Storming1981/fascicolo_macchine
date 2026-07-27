import { timingSafeEqual } from "crypto";

/**
 * Autenticazione per gli endpoint di sincronizzazione machine-to-machine
 * (`/api/sync/*`), usati dal **sync-agent** on-premise che invia i dati del
 * gestionale alla piattaforma quando la VPS non ha visibilità sul SQL Server
 * aziendale.
 *
 * A differenza degli utenti (cookie di sessione), qui l'autenticazione è una
 * API key statica passata come `Authorization: Bearer sk_sync_...`, confrontata
 * con `SYNC_API_KEY` dell'ambiente in modo resistente al timing.
 */

export function isSyncConfigured(): boolean {
  const k = process.env.SYNC_API_KEY;
  return typeof k === "string" && k.startsWith("sk_sync_") && k.length >= 24;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual richiede lunghezze uguali: se differiscono, non è valida,
  // ma confrontiamo comunque contro un buffer della stessa lunghezza per non
  // rivelare l'informazione col tempo di risposta.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Estrae il bearer token dall'header Authorization. */
export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/**
 * True se la richiesta porta una API key di sync valida.
 * Restituisce sempre false se `SYNC_API_KEY` non è configurata (fail-closed).
 */
export function isValidSyncRequest(req: Request): boolean {
  const expected = process.env.SYNC_API_KEY;
  if (!expected || !isSyncConfigured()) return false;
  const token = bearerFrom(req);
  if (!token) return false;
  return safeEqual(token, expected);
}
