import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isFeedConfigured, fetchCommessaHours } from "@/lib/presenceFeed";

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
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
    if (r.hoursWorked === h) continue;

    if (r.closed) {
      // modifica di un rapportino firmato → logga lo stato precedente
      await prisma.rapportinoRevision.create({
        data: {
          rapportinoId: r.id,
          editedById: user.id,
          editedByName: user.name,
          note: `Sincronizzazione ore dal timbratore (${r.hoursWorked ?? "—"} → ${h} h)`,
          snapshot: {
            date: r.date.toISOString(),
            workDescription: r.workDescription,
            ricambi: r.ricambi,
            hoursWorked: r.hoursWorked,
            techName: r.techName,
            clientName: r.clientName,
          },
        },
      });
    }
    await prisma.rapportino.update({ where: { id: r.id }, data: { hoursWorked: h } });
    updated++;
  }

  return NextResponse.json({ ok: true, updated, total: hours.total, byDay: hours.byDay });
}
