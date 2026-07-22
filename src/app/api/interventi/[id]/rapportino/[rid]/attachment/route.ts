import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/** Elimina un allegato di un rapportino. Query: ?attId= */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; rid: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.sign")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id, rid } = await ctx.params;
  const attId = new URL(req.url).searchParams.get("attId");
  if (!attId) return NextResponse.json({ error: "attId mancante" }, { status: 400 });

  // verifica che l'allegato appartenga a questo rapportino/intervento
  const att = await prisma.rapportinoAttachment.findFirst({
    where: { id: attId, rapportino: { id: rid, interventoId: id } },
    select: { id: true },
  });
  if (!att) return NextResponse.json({ error: "Allegato non trovato" }, { status: 404 });

  await prisma.rapportinoAttachment.delete({ where: { id: attId } });
  return NextResponse.json({ ok: true });
}
