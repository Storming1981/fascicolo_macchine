import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentClient, clientConversation } from "@/lib/portalAuth";

/**
 * Chat del portale cliente: SOLO messaggi pubblici della conversazione, e solo
 * se l'intervento appartiene al cliente loggato. I messaggi interni ZATO non
 * transitano mai da qui.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const ok = await clientConversation(id, client.customerId);
  if (!ok) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  const messages = await prisma.message.findMany({
    where: { conversationId: id, visibility: "PUBLIC" },
    orderBy: { sentAt: "asc" },
    select: { id: true, direction: true, authorName: true, body: true, photoPath: true, sentAt: true },
  });
  return NextResponse.json({ messages });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const ok = await clientConversation(id, client.customerId);
  if (!ok) return NextResponse.json({ error: "Non trovata" }, { status: 404 });

  const b = await req.json().catch(() => null);
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  if (!body) return NextResponse.json({ error: "Messaggio vuoto" }, { status: 400 });

  const now = new Date();
  // messaggio del cliente: in ingresso, sempre PUBLICO
  await prisma.message.create({
    data: {
      conversationId: id,
      direction: "IN",
      visibility: "PUBLIC",
      authorId: client.id,
      authorName: client.name,
      body,
      source: "native",
      sentAt: now,
    },
  });
  await prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } });
  return NextResponse.json({ ok: true });
}
