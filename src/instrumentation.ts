/**
 * Hook di avvio del server Next.js.
 * Avvia il polling automatico delle timbrature se configurato:
 *   PRESENCE_SYNC_INTERVAL_MIN=5   (minuti; 0 o assente = disattivato)
 * Richiede anche PRESENCE_FEED_URL/LOGIN_URL/USER/PASS.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const min = Number(process.env.PRESENCE_SYNC_INTERVAL_MIN || "0");
  if (!min || min <= 0) return;

  const g = globalThis as unknown as { __presencePoller?: boolean };
  if (g.__presencePoller) return; // evita doppi avvii (dev / fast refresh)
  g.__presencePoller = true;

  const { isFeedConfigured, syncStampings } = await import("./lib/presenceFeed");
  if (!isFeedConfigured()) {
    console.log("[presence/poll] feed non configurato — polling non avviato");
    return;
  }

  const run = async () => {
    try {
      const r = await syncStampings();
      console.log(`[presence/poll] lette ${r.fetched} · on-site ${r.open} · chiuse ${r.closed}`);
    } catch (e) {
      console.error("[presence/poll]", e instanceof Error ? e.message : e);
    }
  };

  console.log(`[presence/poll] polling timbrature ogni ${min} min`);
  setTimeout(run, 20_000); // primo giro dopo 20s dall'avvio
  setInterval(run, min * 60_000);
}
