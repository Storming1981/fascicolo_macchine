import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isFeedConfigured } from "@/lib/presenceFeed";
import { syncInterventoOre } from "@/lib/rapportinoOre";

/**
 * Sincronizza le ore dei rapportini di un intervento dal timbratore, usando la
 * COMMESSA dell'intervento. Per ogni rapportino imposta hoursWorked = ore
 * timbrate su quel giorno per quella commessa. I rapportini già chiusi vengono
 * modificati registrando una revisione (log) con lo stato precedente e il PDF
 * archiviato viene rigenerato.
 *
 * La logica sta in `src/lib/rapportinoOre.ts` perché la usa anche l'invio
 * automatico dei rapportini, che allinea le ore prima di spedire il PDF.
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
    select: { id: true, commessa: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });
  if (!intervento.commessa)
    return NextResponse.json({ error: "Nessuna commessa impostata sull'intervento." }, { status: 400 });

  try {
    const r = await syncInterventoOre(id, { id: user.id, name: user.name });
    return NextResponse.json({
      ok: true,
      updated: r.updated,
      cleared: r.cleared,
      total: r.total,
      byDay: r.byDay,
      byDayOperator: r.byDayOperator,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore timbratore" }, { status: 502 });
  }
}
