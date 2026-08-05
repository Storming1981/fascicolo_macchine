import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentClient, clientConversation } from "@/lib/portalAuth";

/**
 * DELETE /api/portale/chat/[id]/messages/[msgId]
 * Il cliente può cancellare SOLO i propri messaggi (se scritti per sbaglio).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; msgId: string }> }) {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id, msgId } = await ctx.params;
  const ok = await clientConversation(id, client.customerId);
  if (!ok) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  const msg = await prisma.message.findFirst({
    where: { id: msgId, conversationId: id },
    select: { id: true, authorId: true },
  });
  if (!msg) return NextResponse.json({ error: "Messaggio non trovato" }, { status: 404 });
  if (msg.authorId !== client.id)
    return NextResponse.json({ error: "Puoi cancellare solo i tuoi messaggi." }, { status: 403 });

  await prisma.message.delete({ where: { id: msgId } });
  return NextResponse.json({ ok: true });
}
