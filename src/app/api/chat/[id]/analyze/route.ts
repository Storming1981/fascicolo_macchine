import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { analyzeConversation, isAiConfigured } from "@/lib/chatAI";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  if (!isAiConfigured())
    return NextResponse.json(
      { error: "AI non configurata: imposta ANTHROPIC_API_KEY in .env" },
      { status: 503 }
    );

  const { id } = await ctx.params;
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      machine: { select: { code: true } },
      intervento: { select: { code: true } },
      messages: { orderBy: { sentAt: "asc" }, take: 100 },
    },
  });
  if (!conv) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });
  if (conv.messages.length === 0)
    return NextResponse.json({ error: "Nessun messaggio da analizzare" }, { status: 422 });

  try {
    const analysis = await analyzeConversation(
      conv.messages.map((m) => ({ authorName: m.authorName, direction: m.direction, body: m.body })),
      {
        customer: conv.customer?.name ?? null,
        machine: conv.machine?.code ?? null,
        intervento: conv.intervento?.code ?? null,
      }
    );
    return NextResponse.json({ analysis });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore analisi AI" },
      { status: 502 }
    );
  }
}
