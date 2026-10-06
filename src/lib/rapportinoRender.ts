import "server-only";
import { prisma } from "./db";
import { readUploadAsDataUrl, sha256 } from "./uploads";
import { fmtDayMonth } from "./format";
import { generateRapportinoPdf } from "./rapportinoPdf";
import { sessionHours, endLabel, offsetOf, withDay, daysSpanned, shiftDays, type TimbraturaRow } from "./timbrature";

export type OperatorHours = { name: string; matricola?: string | null; hours: number };

/** Normalizza il Json `hoursByOperator` di un rapportino in un array tipizzato. */
export function parseHoursByOperator(raw: unknown): OperatorHours[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = r as Record<string, unknown>;
      const h = Number(o?.hours);
      return {
        name: String(o?.name ?? "").trim(),
        matricola: o?.matricola != null ? String(o.matricola).trim() || null : null,
        hours: Number.isFinite(h) ? h : 0,
      };
    })
    .filter((r) => r.name || r.hours > 0);
}

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};


/**
 * Raggruppa le timbrature per operatore (con sessioni entrata/uscita + subtotale).
 * Se non ci sono timbrature (vecchi rapportini) ripiega su hoursByOperator.
 */
export function operatorsForPdf(
  timbrature: unknown,
  hoursByOperator: unknown,
  /** Giorno del rapportino: serve a datare le righe che sforano la mezzanotte. */
  date?: Date
): { name: string; sessions: { start: string; end: string; hours: number; type: string | null }[]; total: number }[] {
  const rows: (TimbraturaRow & { name: string })[] = Array.isArray(timbrature)
    ? (timbrature as Record<string, unknown>[]).map((t) => ({
        name: String(t?.name ?? "").trim() || "—",
        start: String(t?.start ?? ""),
        end: String(t?.end ?? ""),
        type: t?.type != null ? String(t.type) : null,
        hours: t?.hours != null ? Number(t.hours) : null,
        endOffset: t?.endOffset != null ? Number(t.endOffset) : null,
      }))
    : [];
  if (rows.length) {
    const map = new Map<string, { start: string; end: string; hours: number; type: string | null }[]>();
    for (const t of rows) {
      const arr = map.get(t.name) ?? [];
      // Turno oltre la mezzanotte: con la data del rapportino si scrivono le
      // date intere ("04-10 11:43" → "05-10 14:05"), altrimenti resta il
      // suffisso "+1g" — senza, una riga 23:00 → 06:00 sembra un refuso.
      const off = offsetOf(t);
      const start = date && off > 0 ? withDay(t.start, date, 0, fmtDayMonth) : t.start;
      const end = date && off > 0 ? withDay(t.end, date, off, fmtDayMonth) : endLabel(t);
      arr.push({ start, end, hours: sessionHours(t), type: t.type ?? null });
      map.set(t.name, arr);
    }
    return [...map.entries()].map(([name, sessions]) => ({
      name,
      sessions,
      total: Math.round(sessions.reduce((n, s) => n + s.hours, 0) * 100) / 100,
    }));
  }
  return parseHoursByOperator(hoursByOperator).map((o) => ({ name: o.name, sessions: [], total: o.hours }));
}

/**
 * Carica un rapportino + intervento e genera il PDF (byte). Reincorpora le firme
 * e le foto salvate come dataURL. Ritorna null se il rapportino non esiste.
 */
export async function renderRapportinoPdf(
  rapportinoId: string
): Promise<{ bytes: Uint8Array; filename: string; interventoId: string; customerEmail: string | null } | null> {
  const r = await prisma.rapportino.findUnique({
    where: { id: rapportinoId },
    include: {
      attachments: { where: { kind: "image" }, orderBy: { createdAt: "asc" }, take: 8, select: { path: true } },
      intervento: {
        include: {
          customer: { select: { name: true, email: true, city: true, province: true, country: true } },
          site: { select: { name: true, address: true, city: true, province: true } },
          machine: { select: { job: true, code: true } },
        },
      },
    },
  });
  if (!r) return null;
  const it = r.intervento;

  const operators = operatorsForPdf(r.timbrature, r.hoursByOperator, r.date);
  // Giornata che sfora la mezzanotte: l'intestazione mostra l'intervallo
  // ("domenica 04-10 → lunedì 05-10"), altrimenti chi legge non sa che il
  // lavoro è proseguito nel giorno dopo.
  const span = daysSpanned(Array.isArray(r.timbrature) ? (r.timbrature as TimbraturaRow[]) : []);
  const dateEnd = span > 0 ? shiftDays(r.date, span) : null;
  const totalHours =
    r.hoursWorked ?? Math.round(operators.reduce((n, o) => n + o.total, 0) * 100) / 100;

  const ricambi =
    (r.ricambi as { code: string; desc: string; qty: string; note: string }[] | null)?.map((x) => ({
      code: String(x.code ?? ""),
      desc: String(x.desc ?? ""),
      qty: String(x.qty ?? ""),
      note: String(x.note ?? ""),
    })) ?? [];

  // Indirizzo scomposto: via, città (+ provincia), nazione
  const addressStreet = it.site?.address || null;
  const city =
    [it.site?.city ?? it.customer?.city, it.site?.province ?? it.customer?.province]
      .filter(Boolean)
      .join(" ") || null;
  const country = it.customer?.country || null;

  const [techSig, clientSig] = await Promise.all([
    readUploadAsDataUrl(r.techSignature),
    readUploadAsDataUrl(r.clientSignature),
  ]);
  const photos = (
    await Promise.all((r.attachments ?? []).map((p) => readUploadAsDataUrl(p.path)))
  ).filter((x): x is string => !!x);

  const hash = r.hash ?? sha256(`${it.id}|${r.id}|draft|${isoDay(r.date)}`);

  const bytes = await generateRapportinoPdf({
    interventoCode: it.code,
    interventoTitle: it.title,
    customer: it.customer?.name ?? null,
    site: it.site?.name ?? null,
    addressStreet,
    city,
    country,
    // numero macchina (job del fascicolo, es. 1260100) e commessa cantiere/timbratore
    machineJob: it.machine?.job || it.machine?.code || null,
    commessa: it.commessa ?? null,
    plantHours: r.plantHours,
    date: r.date,
    dateEnd,
    operators,
    totalHours,
    workDescription: r.workDescription,
    issues: r.issues,
    ricambi,
    photos,
    techName: r.techName,
    techSigDataUrl: techSig,
    clientName: r.clientName,
    clientSigDataUrl: clientSig,
    compiledAt: new Date(),
    hash,
    closed: r.closed,
  });

  const filename = `rapportino-${it.code}-${isoDay(r.date)}.pdf`;
  return { bytes, filename, interventoId: it.id, customerEmail: it.customer?.email ?? null };
}
