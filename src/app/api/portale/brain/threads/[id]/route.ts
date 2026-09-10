import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentClient } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

/** Messaggi di una conversazione del cliente. Lo scope "portal" e il vincolo su
 *  userId impediscono di leggere i thread interni ZATO o quelli di altri. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const thread = await prisma.brainThread.findFirst({
    where: { id, userId: client.id, scope: "portal" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const owned = await prisma.brainThread.findFirst({
    where: { id, userId: client.id, scope: "portal" },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });
  await prisma.brainThread.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
