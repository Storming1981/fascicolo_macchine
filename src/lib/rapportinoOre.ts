import "server-only";
import { prisma } from "./db";
import { fetchCommessaHours, isFeedConfigured } from "./presenceFeed";
import { renderRapportinoPdf } from "./rapportinoRender";
import { saveBytes } from "./uploads";

/**
 * Allineamento delle ore dei rapportini alle timbrature del timbratore.
 *
 * Stessa logica dietro due strade: il pulsante *Sincronizza ore* della scheda
 * intervento e l'invio automatico dei rapportini, che deve allineare le ore
 * **prima** di generare il PDF — altrimenti spedirebbe le ore parziali salvate
 * al momento della firma, che è proprio il motivo per cui si invia il giorno
 * dopo.
 */

/** "YYYY-MM-DD" in ora locale del server (= ora italiana). */
export const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

/** ISO → "HH:MM" in ora locale del server. */
const hhmm = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * Chi risulta come autore della revisione. `id` è null per l'automazione:
 * `RapportinoRevision.editedById` è opzionale, quindi resta il solo nome
 * ("Invio automatico") e nessun utente si prende il merito della modifica.
 */
export type SyncOreActor = { id: string | null; name: string };

export type SyncOreResult = {
  updated: number;
  cleared: number;
  /** Ore totali lette dal timbratore per la commessa (null se non interrogato). */
  total: number | null;
  byDay: Record<string, number>;
  byDayOperator: Record<string, Record<string, number>>;
};

const EMPTY: SyncOreResult = { updated: 0, cleared: 0, total: null, byDay: {}, byDayOperator: {} };

/**
 * Allinea al timbratore le ore dei rapportini di un intervento.
 *
 * `onlyRapportinoId` limita il lavoro a una sola giornata: serve all'invio
 * automatico, che aggiorna il rapportino che sta per spedire senza toccare le
 * altre giornate dell'intervento (e senza riscrivere revisioni a raffica).
 *
 * I rapportini già firmati vengono modificati registrando una revisione con lo
 * stato precedente, e il loro **PDF archiviato viene rigenerato**: è quello che
 * finisce al cliente.
 */
export async function syncInterventoOre(
  interventoId: string,
  actor: SyncOreActor,
  opts: { onlyRapportinoId?: string } = {}
): Promise<SyncOreResult> {
  if (!isFeedConfigured()) return EMPTY;

  const intervento = await prisma.intervento.findUnique({
    where: { id: interventoId },
    include: { rapportini: true, machine: { select: { code: true } } },
  });
  if (!intervento?.commessa) return EMPTY;

  const hours = await fetchCommessaHours(intervento.commessa);

  const target = opts.onlyRapportinoId
    ? intervento.rapportini.filter((r) => r.id === opts.onlyRapportinoId)
    : intervento.rapportini;

  let updated = 0;
  let cleared = 0;

  for (const r of target) {
    const day = isoDay(r.date);
    // Ore del giorno su QUESTA commessa: 0 se non ce ne sono più (es. la
    // timbratura è stata riassegnata a un'altra commessa nel timbratore).
    const h = hours.byDay[day] ?? 0;

    // sessioni entrata/uscita timbrate quel giorno su questa commessa
    // (orig = valore del timbratore, per evidenziare eventuali modifiche manuali)
    const timbrature = hours.sessions
      .filter((s) => s.day === day)
      .map((s) => {
        const name = s.tech ?? "—";
        const start = hhmm(s.start);
        const end = hhmm(s.end);
        return { name, start, end, type: s.type, orig: { name, start, end } };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.start.localeCompare(b.start));

    // aggregato per operatore + totale (dal timbratore)
    const perOp = hours.byDayOperator[day] ?? {};
    const operators = Object.entries(perOp)
      .map(([name, ore]) => ({ name, matricola: null, hours: Math.round(ore * 100) / 100 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const total = operators.length
      ? Math.round(operators.reduce((n, o) => n + o.hours, 0) * 100) / 100
      : h;

    // Salta se nulla è cambiato: evita revisioni inutili sui rapportini chiusi.
    const sameTotal = Math.round((r.hoursWorked ?? 0) * 100) / 100 === total;
    const sameTimb = JSON.stringify(r.timbrature ?? []) === JSON.stringify(timbrature);
    if (sameTotal && sameTimb) continue;

    if (total === 0 && timbrature.length === 0) cleared++;

    if (r.closed) {
      // modifica di un rapportino firmato → logga lo stato precedente
      await prisma.rapportinoRevision.create({
        data: {
          rapportinoId: r.id,
          editedById: actor.id,
          editedByName: actor.name,
          note: `Sincronizzazione timbrature (${r.hoursWorked ?? "—"} → ${total} h)`,
          snapshot: {
            date: r.date.toISOString(),
            workDescription: r.workDescription,
            ricambi: r.ricambi,
            hoursWorked: r.hoursWorked,
            hoursByOperator: r.hoursByOperator,
            timbrature: r.timbrature,
            techName: r.techName,
            clientName: r.clientName,
          },
        },
      });
    }

    await prisma.rapportino.update({
      where: { id: r.id },
      data: { hoursWorked: total, hoursByOperator: operators, timbrature },
    });

    // Rapportino già firmato: il PDF archiviato conteneva le ore parziali del
    // momento della firma → va rigenerato con le ore complete, perché è quello
    // che poi si invia al cliente.
    if (r.closed) {
      const scope = intervento.machine?.code
        ? `${intervento.machine.code}/interventi`
        : `service/${intervento.code}`;
      try {
        const out = await renderRapportinoPdf(r.id);
        if (out) {
          const pdfPath = await saveBytes(out.bytes, scope, `rapportino-${r.id}.pdf`);
          await prisma.rapportino.update({ where: { id: r.id }, data: { pdfPath } });
        }
      } catch {
        // la mancata rigenerazione non deve far fallire la sincronizzazione
      }
    }
    updated++;
  }

  return {
    updated,
    cleared,
    total: hours.total,
    byDay: hours.byDay,
    byDayOperator: hours.byDayOperator,
  };
}
