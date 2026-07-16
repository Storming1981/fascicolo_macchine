import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Elenco delle commesse (codici parlanti 9 cifre) note dal timbratore: sono i
 * valori realmente timbrati dagli operatori, raccolti nella tabella
 * TechPresence dal connettore. A ciascuna, quando risolta, è associato il
 * cantiere/cliente (per la label del menu a tendina nella scheda intervento).
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const rows = await prisma.techPresence.findMany({
    where: { commessa: { not: null } },
    select: {
      commessa: true,
      site: { select: { name: true, city: true, customer: { select: { name: true } } } },
    },
    orderBy: { clockIn: "desc" },
  });

  // deduplica per commessa, tenendo la prima label disponibile
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.commessa) continue;
    if (!map.has(r.commessa)) {
      const parts = [r.site?.customer?.name, r.site?.city].filter(Boolean);
      map.set(r.commessa, parts.join(" · "));
    } else if (!map.get(r.commessa)) {
      const parts = [r.site?.customer?.name, r.site?.city].filter(Boolean);
      if (parts.length) map.set(r.commessa, parts.join(" · "));
    }
  }

  const commesse = [...map.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return NextResponse.json({ commesse });
}
