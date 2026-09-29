import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { loadTeamDocs } from "@/lib/tecniciDocs";

/**
 * Documenti TeamSystem della squadra di un intervento (capo cantiere +
 * tecnici): attestati, idoneità, DPI, nomine, coperture + corsi di formazione.
 * `?refresh=1` rilegge subito il fascicolo invece di usare la lettura recente.
 * Stessa regola di accesso della scheda: chi vede tutti gli interventi, oppure
 * chi è in squadra.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  if (!(await userCan(user.role, "intervento.viewAll"))) {
    const onTeam = await prisma.intervento.count({
      where: {
        id,
        OR: [{ assignedTechId: user.id }, { participants: { some: { id: user.id } } }],
      },
    });
    if (!onTeam) return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const data = await loadTeamDocs(id, { refresh });
  if (!data) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });
  return NextResponse.json(data);
}
