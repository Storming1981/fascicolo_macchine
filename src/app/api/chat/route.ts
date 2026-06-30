import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const conversations = await prisma.conversation.findMany({
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    include: {
      customer: { select: { name: true } },
      machine: { select: { code: true } },
      intervento: { select: { code: true } },
      _count: { select: { messages: true } },
    },
  });
  return NextResponse.json({ conversations });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.send")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b.title !== "string" || !b.title.trim())
    return NextResponse.json({ error: "Titolo obbligatorio" }, { status: 400 });

  const conv = await prisma.conversation.create({
    data: {
      title: b.title.trim(),
      channel: "native",
      contactName: typeof b.contactName === "string" ? b.contactName.trim() || null : null,
      customerId: b.customerId || null,
      machineId: b.machineId || null,
      interventoId: b.interventoId || null,
      lastMessageAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, id: conv.id });
}
