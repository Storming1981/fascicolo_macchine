import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { indexSource } from "@/lib/brain/indexer";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Rilegge il documento e ricostruisce l'indice (utile dopo un OCR fallito). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const source = await prisma.knowledgeSource.findUnique({ where: { id }, select: { id: true } });
  if (!source) return NextResponse.json({ error: "Fonte non trovata" }, { status: 404 });

  // Come per l'upload: si risponde subito e si lavora dopo (vedi il commento in
  // ../route.ts). Lo stato passa a "In lavorazione" e la lista lo segue.
  await prisma.knowledgeSource.update({ where: { id }, data: { status: "PROCESSING", error: null } });
  after(async () => {
    try {
      await indexSource(id, { force: true });
    } catch {
      /* indexSource segna già FAILED */
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
