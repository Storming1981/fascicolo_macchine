/**
 * Hook di avvio del server Next.js.
 * - Avanzamento automatico interventi (pianificato → in corso al giorno previsto).
 * - Invio automatico dei rapportini giornalieri all'ora impostata.
 * - Polling automatico delle timbrature se configurato:
 *     PRESENCE_SYNC_INTERVAL_MIN=5   (minuti; 0 o assente = disattivato)
 *   Richiede anche PRESENCE_FEED_URL/LOGIN_URL/USER/PASS.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  startAutoProgress();
  startRapportinoMail();
  startPresencePoller();
}

/**
 * Ogni minuto controlla se è arrivata l'ora dell'invio automatico dei
 * rapportini (configurata in Impostazioni). Il controllo è al minuto perché
 * l'orario è scelto dall'utente: con un tick più lungo la mail partirebbe
 * "verso" l'ora impostata invece che a quell'ora. Il giro vero parte una volta
 * sola al giorno (lo stato sta in banca dati, quindi regge anche i riavvii).
 */
function startRapportinoMail() {
  const g = globalThis as unknown as { __rapportinoMail?: boolean };
  if (g.__rapportinoMail) return;
  g.__rapportinoMail = true;

  let announced = false;
  let lastReason: string | null = null;
  const run = async () => {
    try {
      // L'import sta DENTRO il ramo `=== "nodejs"` perché il bundle edge di
      // instrumentation altrimenti si tira dietro il generatore PDF (fs, path,
      // crypto) e la build segnala "node module in edge runtime". In questa
      // forma il ramo viene eliminato a monte.
      if (process.env.NEXT_RUNTIME !== "nodejs") return;
      const { runRapportinoMailIfDue, getRapportinoMailConfig, getRapportinoMailState } = await import(
        "./lib/rapportinoMail"
      );

      // Una riga all'avvio dice se lo scheduler è acceso e a che ora punta:
      // senza, un invio che non parte non lascia traccia nei log e non si
      // distingue "spento" da "rotto".
      if (!announced) {
        announced = true;
        const cfg = await getRapportinoMailConfig();
        const st = await getRapportinoMailState();
        console.log(
          cfg.enabled
            ? `[rapportini/mail] attivo: invio alle ${cfg.time} a ${cfg.to.length} destinatari · ultimo giro automatico: ${st.lastRunDay ?? "mai"}`
            : "[rapportini/mail] invio automatico disattivato"
        );
      }

      const r = await runRapportinoMailIfDue();
      if (!r) return;
      if (r.reason) {
        // Configurazione incompleta (es. Gmail non collegata): il giro non
        // segna la giornata come fatta, quindi riprova ogni minuto. Si logga
        // solo al cambio di motivo, altrimenti riempie i log di righe uguali.
        if (r.reason !== lastReason) {
          lastReason = r.reason;
          console.log(`[rapportini/mail] non eseguito: ${r.reason}`);
        }
        return;
      }
      lastReason = null;
      console.log(
        `[rapportini/mail] inviati ${r.sent} · rimandati ${r.skipped}` +
          (r.errors.length ? ` · errori ${r.errors.length}: ${r.errors.join(" | ")}` : "")
      );
    } catch (e) {
      console.error("[rapportini/mail]", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 40_000); // primo controllo poco dopo l'avvio
  setInterval(run, 60_000);
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
