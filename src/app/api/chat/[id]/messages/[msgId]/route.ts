import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/chat/[id]/messages/[msgId]
 * Cancella un messaggio: consentito solo all'AUTORE (o a un ADMIN). Se il
 * messaggio aveva una foto confluita nel corpus (Photo category "chat"), la
 * rimuove anche da lì.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; msgId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.send")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id, msgId } = await ctx.params;
  const msg = await prisma.message.findFirst({
    where: { id: msgId, conversationId: id },
    select: { id: true, authorId: true, photoPath: true },
  });
  if (!msg) return NextResponse.json({ error: "Messaggio non trovato" }, { status: 404 });

  if (msg.authorId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "Puoi cancellare solo i tuoi messaggi." }, { status: 403 });

  if (msg.photoPath)
    await prisma.photo.deleteMany({ where: { path: msg.photoPath, category: "chat" } });
  await prisma.message.delete({ where: { id: msgId } });

  return NextResponse.json({ ok: true });
}
