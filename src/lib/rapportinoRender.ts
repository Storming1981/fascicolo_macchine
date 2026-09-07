import "server-only";
import { prisma } from "./db";
import { readUploadAsDataUrl, sha256 } from "./uploads";
import { generateRapportinoPdf } from "./rapportinoPdf";

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

type Timbratura = { name: string; start: string; end: string; hours?: number | null };
const toMin = (hhmm: string): number | null => {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const sessionHours = (start: string, end: string): number => {
  const s = toMin(start);
  const e = toMin(end);
  return s != null && e != null && e > s ? Math.round(((e - s) / 60) * 100) / 100 : 0;
};

/**
 * Raggruppa le righe ore per operatore (con sessioni entrata/uscita + subtotale).
 * Le righe compilate a mano possono non avere orari: in quel caso valgono le
 * ore dichiarate. Se non ci sono righe (vecchi rapportini) ripiega su
 * hoursByOperator.
 */
function operatorsForPdf(
  timbrature: unknown,
  hoursByOperator: unknown
): { name: string; sessions: { start: string; end: string; hours: number }[]; total: number }[] {
  const rows: Timbratura[] = Array.isArray(timbrature)
    ? (timbrature as Record<string, unknown>[]).map((t) => {
        const h = Number(t?.hours);
        return {
          name: String(t?.name ?? "").trim() || "—",
          start: String(t?.start ?? ""),
          end: String(t?.end ?? ""),
          hours: Number.isFinite(h) ? h : null,
        };
      })
    : [];
  if (rows.length) {
    const map = new Map<string, { start: string; end: string; hours: number }[]>();
    for (const t of rows) {
      const arr = map.get(t.name) ?? [];
      const fromClock = sessionHours(t.start, t.end);
      arr.push({ start: t.start, end: t.end, hours: fromClock > 0 ? fromClock : Math.max(0, t.hours ?? 0) });
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

  const operators = operatorsForPdf(r.timbrature, r.hoursByOperator);
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
