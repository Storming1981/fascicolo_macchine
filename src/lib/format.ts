/**
 * Formati comuni. **Tutte le date della piattaforma si scrivono gg-mm-aaaa.**
 *
 * Sono costruite a mano invece che con `toLocaleDateString`: così il formato è
 * lo stesso ovunque — server, browser, PDF — e non dipende dalla lingua del
 * sistema né dal fuso del container. Con `toLocaleString` la stessa data poteva
 * uscire "18/12/2026" sul server e in un altro modo sul client, e in React una
 * differenza del genere fa saltare l'idratazione.
 *
 * Chi deve mostrare una data **non usa `toLocaleDateString`**: passa da qui.
 */

const p2 = (n: number) => String(n).padStart(2, "0");

const asDate = (d: Date | string | null | undefined): Date | null => {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return isNaN(date.getTime()) ? null : date;
};

/** 18-12-2026 */
export function fmtDate(d: Date | string | null | undefined): string {
  const date = asDate(d);
  if (!date) return "—";
  return `${p2(date.getDate())}-${p2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** 18-12-2026 14:30 */
export function fmtDateTime(d: Date | string | null | undefined): string {
  const date = asDate(d);
  if (!date) return "—";
  return `${fmtDate(date)} ${p2(date.getHours())}:${p2(date.getMinutes())}`;
}

/** 18-12 · per le etichette strette (mappa, chat) dove l'anno si capisce dal contesto. */
export function fmtDayMonth(d: Date | string | null | undefined): string {
  const date = asDate(d);
  if (!date) return "—";
  return `${p2(date.getDate())}-${p2(date.getMonth() + 1)}`;
}

/** 18-12 14:30 · timbro dei messaggi in chat. */
export function fmtDayMonthTime(d: Date | string | null | undefined): string {
  const date = asDate(d);
  if (!date) return "—";
  return `${fmtDayMonth(date)} ${p2(date.getHours())}:${p2(date.getMinutes())}`;
}

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/**
 * lunedì 14-09-2026 — per le intestazioni dei rapportini, dove il giorno della
 * settimana serve davvero a chi legge in cantiere. La data resta gg-mm-aaaa.
 */
export function fmtDateLong(d: Date | string | null | undefined): string {
  const date = asDate(d);
  if (!date) return "—";
  return `${GIORNI[date.getDay()]} ${fmtDate(date)}`;
}

/** lun 14-09 — versione corta della precedente. */
export function fmtDayShort(d: Date | string | null | undefined): string {
  const date = asDate(d);
  if (!date) return "—";
  return `${GIORNI[date.getDay()].slice(0, 3)} ${fmtDayMonth(date)}`;
}

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/**
 * Durata in ore e minuti. Le sessioni nascono da timbrature (HH:MM) e la somma
 * in decimali non si legge: "8.72" sono 8h 43m, non 8 ore e 72 minuti.
 * Non usarla per i CONTAORE dell'impianto, che sono un contatore, non una durata.
 */
export function fmtHM(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  const sign = hours < 0 ? "-" : "";
  const mins = Math.round(Math.abs(hours) * 60);
  return `${sign}${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}
