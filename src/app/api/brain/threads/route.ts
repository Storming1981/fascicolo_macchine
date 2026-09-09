import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Le conversazioni con il Brain dell'utente corrente. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.ask")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const threads = await prisma.brainThread.findMany({
    where: { userId: user.id, scope: "internal" },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
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
