/**
 * Righe entrata/uscita di un rapportino: tipo e calcolo delle ore.
 *
 * Modulo **puro** (niente `server-only`): lo usano la scheda intervento (client),
 * il PDF del rapportino e quello del riepilogo (server), e la regola di calcolo
 * deve essere la stessa in tutti e tre.
 *
 * **Turni a cavallo della mezzanotte.** Un viaggio intercontinentale comincia un
 * giorno e finisce il successivo: la timbratura 04-10 11:43 → 05-10 14:05 dura
 * 26h 22m, non 2h 22m. Il timbratore lo sa (calcola la durata dalle date
 * complete) ma la riga del rapportino tiene solo "HH:MM", quindi l'informazione
 * del giorno andava persa e la riga mostrava due ore invece di ventisei, mentre
 * il totale di giornata — che viene dall'aggregato del timbratore — era giusto.
 * Da qui i due campi:
 *   `hours`      durata reale della sessione, come la calcola il timbratore
 *   `endOffset`  quanti giorni dopo cade l'uscita (0 stesso giorno, 1 il giorno dopo…)
 *
 * La giornata di competenza resta quella di **inizio** del turno: è la stessa
 * convenzione del timbratore (`byDay` è indicizzato sul giorno di entrata),
 * quindi le ore non si spezzano fra due rapportini.
 */

export type TimbraturaRow = {
  name: string;
  /** Entrata "HH:MM". */
  start: string;
  /** Uscita "HH:MM" (vuota se la timbratura è ancora aperta). */
  end: string;
  /** Lavoro / Viaggio, dal timbratore. */
  type?: string | null;
  /** Durata reale in ore, dal timbratore. Assente sulle sessioni ancora aperte. */
  hours?: number | null;
  /** Giorni fra entrata e uscita: 0 = stessa giornata, 1 = uscita il giorno dopo. */
  endOffset?: number | null;
};

const toMin = (hhmm: string): number | null => {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Ore di una sessione. In ordine: la durata del timbratore se c'è, altrimenti
 * gli orari con lo scarto di giorni; se lo scarto manca ma l'uscita è "prima"
 * dell'entrata si assume il giorno dopo — così tornano giuste anche le righe
 * salvate prima che `endOffset` esistesse, senza doverle migrare.
 */
export function sessionHours(row: Pick<TimbraturaRow, "start" | "end" | "hours" | "endOffset">): number {
  const h = Number(row?.hours);
  if (Number.isFinite(h) && h > 0) return Math.round(h * 100) / 100;

  const a = toMin(row?.start ?? "");
  const b = toMin(row?.end ?? "");
  if (a == null || b == null) return 0;

  const off = Number(row?.endOffset);
  const days = Number.isFinite(off) && off > 0 ? Math.round(off) : b <= a ? 1 : 0;
  const minuti = b + days * 1440 - a;
  return minuti > 0 ? Math.round((minuti / 60) * 100) / 100 : 0;
}

/** Vero se il turno finisce in un giorno diverso da quello di entrata. */
export function endsOnAnotherDay(row: Pick<TimbraturaRow, "start" | "end" | "endOffset">): boolean {
  const off = Number(row?.endOffset);
  if (Number.isFinite(off)) return off > 0;
  const a = toMin(row?.start ?? "");
  const b = toMin(row?.end ?? "");
  return a != null && b != null && b <= a;
}

/**
 * Uscita da mostrare: "14:05" oppure "14:05 +1g" quando cade il giorno dopo.
 * Senza il suffisso una riga 23:00 → 06:00 sembra un errore di battitura.
 */
export function endLabel(row: Pick<TimbraturaRow, "start" | "end" | "endOffset">): string {
  const end = (row?.end ?? "").trim();
  if (!end) return "";
  if (!endsOnAnotherDay(row)) return end;
  const off = Number(row?.endOffset);
  const days = Number.isFinite(off) && off > 0 ? Math.round(off) : 1;
  return `${end} +${days}g`;
}
