import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isFeedConfigured, fetchCommessaHours } from "@/lib/presenceFeed";

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

/** ISO → "HH:MM" in ora locale del server (= ora italiana). */
const hhmm = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * Sincronizza le ore dei rapportini di un intervento dal timbratore, usando la
 * COMMESSA dell'intervento. Per ogni rapportino imposta hoursWorked = ore
 * timbrate su quel giorno per quella commessa. I rapportini già chiusi vengono
 * modificati registrando una revisione (log) con lo stato precedente.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isFeedConfigured())
    return NextResponse.json({ error: "Timbratore non configurato" }, { status: 503 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    include: { rapportini: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });
  if (!intervento.commessa)
    return NextResponse.json({ error: "Nessuna commessa impostata sull'intervento." }, { status: 400 });

  let hours;
  try {
    hours = await fetchCommessaHours(intervento.commessa);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore timbratore" }, { status: 502 });
  }

  let updated = 0;
  for (const r of intervento.rapportini) {
    const day = isoDay(r.date);
    const h = hours.byDay[day];
    if (h == null) continue;

    // sessioni entrata/uscita timbrate quel giorno su questa commessa
    // (orig = valore del timbratore, per evidenziare eventuali modifiche manuali)
    const timbrature = hours.sessions
      .filter((s) => s.day === day)
      .map((s) => {
        const name = s.tech ?? "—";
        const start = hhmm(s.start);
        const end = hhmm(s.end);
        return { name, start, end, orig: { name, start, end } };
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

    if (r.closed) {
      // modifica di un rapportino firmato → logga lo stato precedente
      await prisma.rapportinoRevision.create({
        data: {
          rapportinoId: r.id,
          editedById: user.id,
          editedByName: user.name,
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
    updated++;
  }

  return NextResponse.json({
    ok: true,
    updated,
    total: hours.total,
    byDay: hours.byDay,
    byDayOperator: hours.byDayOperator,
  });
}
