import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      machine: { select: { id: true, code: true, job: true } },
      intervento: { select: { id: true, code: true, title: true } },
      messages: { orderBy: { sentAt: "asc" } },
    },
  });
  if (!conv) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.send")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  if (!body) return NextResponse.json({ error: "Messaggio vuoto" }, { status: 400 });

  const conv = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!conv) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });

  const now = new Date();
  await prisma.message.create({
    data: {
      conversationId: id,
      direction: "OUT",
      authorName: user.name,
      body,
      source: "native",
      sentAt: now,
    },
  });
  await prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } });

  return NextResponse.json({ ok: true });
}
