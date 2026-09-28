/**
 * Configurazione dell'invio automatico dei rapportini: tipi, default e
 * normalizzazione. Modulo **puro** (niente `server-only`, niente accesso al
 * disco o al DB) perché lo importa anche la pagina Impostazioni, che è un
 * componente client: come per `permissions.ts` e `nav.ts`, il motore vero sta
 * altrove (`rapportinoMail.ts`, server-only).
 */

export type RapportinoMailConfig = {
  /** Invio automatico attivo. */
  enabled: boolean;
  /** Destinatari fissi (A). */
  to: string[];
  /** Destinatari in copia (Cc). */
  cc: string[];
  /** Ora locale dell'invio giornaliero, "HH:MM". */
  time: string;
  /** Allega anche foto e file del rapportino, oltre al PDF. */
  includeAttachments: boolean;
  /** Aggiunge in Cc l'indirizzo del cliente dell'intervento, se presente. */
  includeCustomer: boolean;
  /** Quanti giorni indietro recuperare i rapportini non inviati. */
  maxDays: number;
  /**
   * Momento in cui l'invio automatico è stato acceso (lo scrive il server).
   * Il giro automatico parte solo dai rapportini di quel giorno in avanti:
   * accendere l'invio non deve far partire in blocco settimane di arretrati
   * al primo giro. Per spedire anche quelli c'è *Invia adesso*, che è una
   * scelta esplicita e mostra quanti sono.
   */
  activatedAt: string | null;
};

export const DEFAULT_RAPPORTINO_MAIL: RapportinoMailConfig = {
  enabled: false,
  to: [],
  cc: [],
  time: "18:30",
  includeAttachments: true,
  includeCustomer: false,
  maxDays: 7,
  activatedAt: null,
};

/** Esito dell'ultima esecuzione, per mostrarlo in Impostazioni. */
export type RapportinoMailState = {
  /** Giorno dell'ultimo giro automatico ("YYYY-MM-DD"): evita il doppio invio. */
  lastRunDay: string | null;
  lastRunAt: string | null;
  lastSent: number;
  lastSkipped: number;
  lastErrors: string[];
};

export const EMPTY_RAPPORTINO_MAIL_STATE: RapportinoMailState = {
  lastRunDay: null,
  lastRunAt: null,
  lastSent: 0,
  lastSkipped: 0,
  lastErrors: [],
};

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Estrae indirizzi validi da una stringa ("a@x, b@y") o da un array. */
export function parseEmails(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw ?? "").split(/[,;\s]+/);
  const out: string[] = [];
  for (const item of list) {
    const e = item.trim();
    // niente validazione fine: basta che sia un indirizzo, il resto lo dice Gmail
    if (e.includes("@") && e.length > 2 && !out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

export function mergeRapportinoMail(stored: unknown): RapportinoMailConfig {
  const s = (stored ?? {}) as Partial<RapportinoMailConfig>;
  const days = Number(s.maxDays);
  return {
    enabled: s.enabled === true,
    to: parseEmails(s.to),
    cc: parseEmails(s.cc),
    time: typeof s.time === "string" && HHMM.test(s.time) ? s.time : DEFAULT_RAPPORTINO_MAIL.time,
    includeAttachments: s.includeAttachments !== false,
    includeCustomer: s.includeCustomer === true,
    maxDays: Number.isFinite(days) && days >= 1 && days <= 60 ? Math.round(days) : DEFAULT_RAPPORTINO_MAIL.maxDays,
    activatedAt: typeof s.activatedAt === "string" ? s.activatedAt : null,
  };
}

export function mergeRapportinoMailState(stored: unknown): RapportinoMailState {
  const s = (stored ?? {}) as Partial<RapportinoMailState>;
  return {
    lastRunDay: typeof s.lastRunDay === "string" ? s.lastRunDay : null,
    lastRunAt: typeof s.lastRunAt === "string" ? s.lastRunAt : null,
    lastSent: Number(s.lastSent) || 0,
    lastSkipped: Number(s.lastSkipped) || 0,
    lastErrors: Array.isArray(s.lastErrors) ? s.lastErrors.map(String).slice(0, 10) : [],
  };
}
