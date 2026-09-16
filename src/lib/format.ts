export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
