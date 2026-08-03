import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentClient } from "@/lib/portalAuth";

/**
 * Interventi del cliente loggato (portale), con la chat collegata e il conteggio
 * dei messaggi pubblici. Nessun dato interno ZATO.
 */
export async function GET() {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const rows = await prisma.intervento.findMany({
    where: { customerId: client.customerId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      site: { select: { name: true } },
      machine: { select: { code: true, job: true } },
      conversations: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          _count: { select: { messages: true } },
        },
      },
    },
  });

  const items = await Promise.all(
    rows.map(async (i) => {
      const conv = i.conversations[0] ?? null;
      const publicCount = conv
        ? await prisma.message.count({ where: { conversationId: conv.id, visibility: "PUBLIC" } })
        : 0;
      return {
        id: i.id,
        code: i.code,
        title: i.title,
        status: i.status,
        site: i.site?.name ?? null,
        machine: i.machine?.job || i.machine?.code || null,
        chatId: conv?.id ?? null,
        publicMessages: publicCount,
      };
    }),
  );

  return NextResponse.json({ items });
}
