import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Messaggi di una conversazione con il Brain (solo le proprie). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.ask")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const thread = await prisma.brainThread.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { id } = await ctx.params;
  const owned = await prisma.brainThread.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });
  await prisma.brainThread.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
