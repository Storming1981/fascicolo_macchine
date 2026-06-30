import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.send")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const data: Prisma.ConversationUpdateInput = {};
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
  if (typeof b.contactName === "string") data.contactName = b.contactName.trim() || null;
  if ("customerId" in b)
    data.customer = b.customerId ? { connect: { id: b.customerId } } : { disconnect: true };
  if ("machineId" in b)
    data.machine = b.machineId ? { connect: { id: b.machineId } } : { disconnect: true };
  if ("interventoId" in b)
    data.intervento = b.interventoId ? { connect: { id: b.interventoId } } : { disconnect: true };

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  await prisma.conversation.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.send")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const { id } = await ctx.params;
  await prisma.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
