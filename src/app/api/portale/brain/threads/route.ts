import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentClient } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

/** Le conversazioni con il Brain del cliente collegato (solo le proprie). */
export async function GET() {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const threads = await prisma.brainThread.findMany({
    where: { userId: client.id, scope: "portal" },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
  });
  return NextResponse.json({
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      messages: t._count.messages,
    })),
  });
}
