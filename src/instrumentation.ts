/**
 * Hook di avvio del server Next.js.
 * - Avanzamento automatico interventi (pianificato → in corso al giorno previsto).
 * - Polling automatico delle timbrature se configurato:
 *     PRESENCE_SYNC_INTERVAL_MIN=5   (minuti; 0 o assente = disattivato)
 *   Richiede anche PRESENCE_FEED_URL/LOGIN_URL/USER/PASS.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  startAutoProgress();
  startPresencePoller();
}

/**
 * Ogni ora (+ subito dopo l'avvio) porta a IN_CORSO gli interventi pianificati
 * il cui giorno è arrivato. Disattivabile con AUTO_PROGRESS_DISABLED=1.
 */
function startAutoProgress() {
  if (process.env.AUTO_PROGRESS_DISABLED === "1") return;
  const g = globalThis as unknown as { __autoProgress?: boolean };
  if (g.__autoProgress) return;
  g.__autoProgress = true;

  const run = async () => {
    try {
      const { autoProgressInterventi } = await import("./lib/interventoAuto");
      const r = await autoProgressInterventi();
      if (r.started > 0) console.log(`[interventi/auto] ${r.started} → in corso (giorno pianificato)`);
    } catch (e) {
      console.error("[interventi/auto]", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 25_000); // primo giro poco dopo l'avvio
  setInterval(run, 60 * 60_000); // poi ogni ora
}

async function startPresencePoller() {
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

  startStampingHistory();
}

/**
 * Copia locale delle timbrature per l'analisi ore del fascicolo: ogni ora gli
 * ultimi 14 giorni. A tabella vuota (primo avvio) scarica prima lo storico
 * intero: il timbratore parte dal 2024 (~1.700 timbrature l'anno, ~30 s l'anno).
 */
function startStampingHistory() {
  const run = async () => {
    try {
      const { prisma } = await import("./lib/db");
      const { syncRecentStampings, syncStampingHistory } = await import("./lib/presenceFeed");
      if ((await prisma.stamping.count()) === 0) {
        const thisYear = new Date().getFullYear();
        for (let y = 2024; y <= thisYear; y++) {
          const r = await syncStampingHistory(`${y}-01-01`, `${y}-12-31`);
          console.log(`[stampings/storico] ${y}: ${r.fetched} timbrature`);
        }
      }
      const r = await syncRecentStampings(14);
      console.log(`[stampings] ${r.fetched} timbrature (14 gg) · rimosse ${r.removed}`);
    } catch (e) {
      console.error("[stampings]", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 60 * 60_000);
}
