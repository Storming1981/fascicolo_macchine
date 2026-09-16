import "server-only";
import { prisma } from "./db";
import { sha256 } from "./uploads";
import { isTravel } from "./pdfCommon";
import { operatorsForPdf } from "./rapportinoRender";
import { generateRiepilogoPdf, type RiepilogoDay } from "./riepilogoPdf";

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

/**
 * PDF riepilogativo di un intervento: tutte le giornate una dopo l'altra, con
 * la firma unica di fine intervento. Rigenerato ogni volta dai dati correnti,
 * come il rapportino giornaliero. null se l'intervento non esiste o non ha
 * ancora rapportini.
 */
export async function renderRiepilogoPdf(
  interventoId: string
): Promise<{ bytes: Uint8Array; filename: string; days: number } | null> {
  const it = await prisma.intervento.findUnique({
    where: { id: interventoId },
    include: {
      customer: { select: { name: true, city: true, province: true, country: true } },
      site: { select: { name: true, address: true, city: true, province: true } },
      machine: { select: { job: true, code: true } },
      rapportini: { orderBy: { date: "asc" } },
    },
  });
  if (!it || it.rapportini.length === 0) return null;

  const days: RiepilogoDay[] = it.rapportini.map((r) => {
    const operators = operatorsForPdf(r.timbrature, r.hoursByOperator);
    return {
      date: r.date,
      closed: r.closed,
      operators,
      totalHours: r.hoursWorked ?? Math.round(operators.reduce((n, o) => n + o.total, 0) * 100) / 100,
      workDescription: r.workDescription,
      issues: r.issues,
    };
  });

  // totali di tutto l'intervento: ore, quota viaggio e ore per operatore
  const byOperator = new Map<string, number>();
  let travelHours = 0;
  for (const d of days) {
    for (const op of d.operators) {
      byOperator.set(op.name, Math.round(((byOperator.get(op.name) ?? 0) + op.total) * 100) / 100);
      for (const s of op.sessions) if (isTravel(s.type)) travelHours += s.hours;
    }
  }
  const totals = {
    hours: Math.round(days.reduce((n, d) => n + d.totalHours, 0) * 100) / 100,
    travelHours: Math.round(travelHours * 100) / 100,
    byOperator: [...byOperator.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  const city =
    [it.site?.city ?? it.customer?.city, it.site?.province ?? it.customer?.province].filter(Boolean).join(" ") ||
    null;

  const bytes = await generateRiepilogoPdf({
    interventoCode: it.code,
    interventoTitle: it.title,
    customer: it.customer?.name ?? null,
    site: it.site?.name ?? null,
    addressStreet: it.site?.address ?? null,
    city,
    country: it.customer?.country ?? null,
    machineJob: it.machine?.job || it.machine?.code || null,
    commessa: it.commessa ?? null,
    days,
    totals,
    techName: it.summaryTechName,
    techSigDataUrl: it.summaryTechSignature,
    clientName: it.summaryClientName,
    clientSigDataUrl: it.summaryClientSignature,
    signedAt: it.summarySignedAt,
    generatedAt: new Date(),
    hash: sha256(`${it.id}|riepilogo|${days.length}|${isoDay(days[days.length - 1].date)}`),
  });

  return {
    bytes,
    filename: `riepilogo-${it.code}-${isoDay(days[days.length - 1].date)}.pdf`,
    days: days.length,
  };
}
