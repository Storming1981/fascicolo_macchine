import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Sposta un intervento nel CESTINO (soft-delete) o lo RIPRISTINA.
 * Body: { restore?: boolean }  → restore=true riporta l'intervento in lista.
 * L'intervento non viene cancellato: resta nel DB con `deletedAt` valorizzato,
 * così i dati collegati (rapportini, diario, foto) restano intatti.
 * Permesso: `intervento.edit`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({ where: { id }, select: { id: true } });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const restore = body?.restore === true;

  await prisma.intervento.update({
    where: { id },
    data: restore
      ? { deletedAt: null, deletedByName: null }
      : { deletedAt: new Date(), deletedByName: user.name },
  });

  return NextResponse.json({ ok: true, deleted: !restore });
}
