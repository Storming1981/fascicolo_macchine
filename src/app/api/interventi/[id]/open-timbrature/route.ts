import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isFeedConfigured, fetchOpenSessionsForCommessa } from "@/lib/presenceFeed";

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

/**
 * Timbrature ancora aperte (operatori senza uscita) per la commessa di un
 * intervento, raggruppate per giorno. Serve al rapportino per avvisare che le
 * ore sono parziali e per bloccare la chiusura finché non c'è l'uscita.
 * Query: ?day=YYYY-MM-DD per limitare la risposta a un giorno.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: { commessa: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  if (!intervento.commessa || !isFeedConfigured())
    return NextResponse.json({ configured: false, open: [], byDay: {} });

  const dayFilter = new URL(req.url).searchParams.get("day");
  const now = new Date();

  try {
    const sessions = await fetchOpenSessionsForCommessa(intervento.commessa);
    const open = sessions.map((s) => ({
      tech: s.tech,
      // una sessione aperta senza data d'inizio parsabile è di "oggi"
      day: isoDay(s.startedAt ?? now),
      since: s.startedAt ? s.startedAt.toISOString() : null,
    }));
    const filtered = dayFilter ? open.filter((o) => o.day === dayFilter) : open;
    const byDay: Record<string, number> = {};
    for (const o of open) byDay[o.day] = (byDay[o.day] ?? 0) + 1;
    return NextResponse.json({ configured: true, open: filtered, byDay });
  } catch (e) {
    // timbratore non raggiungibile → non blocchiamo nulla (open vuoto)
    return NextResponse.json({
      configured: true,
      open: [],
      byDay: {},
      error: e instanceof Error ? e.message : "Errore timbratore",
    });
  }
}
