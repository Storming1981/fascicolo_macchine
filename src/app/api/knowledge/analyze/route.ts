import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { analyzeRecurringIssues, isAiConfigured, type InterventoCorpus } from "@/lib/knowledgeAI";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  → ultimo KnowledgeInsight salvato (problematiche ricorrenti).
 * POST → genera una nuova analisi AI sul corpus (interventi + chat + rapportini)
 *        e la salva come KnowledgeInsight. Permesso: knowledge.manage.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const latest = await prisma.knowledgeInsight.findFirst({
    where: { scope: "recurring-issues" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ insight: latest, aiConfigured: isAiConfigured() });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isAiConfigured())
    return NextResponse.json({ error: "AI non configurata (ANTHROPIC_API_KEY)" }, { status: 503 });

  // Corpus: interventi non nel cestino, con chat + problematiche rapportini.
  const rows = await prisma.intervento.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      code: true,
      title: true,
      type: true,
      machine: { select: { model: true, plantType: true } },
      conversations: {
        select: { messages: { select: { body: true }, orderBy: { sentAt: "asc" } } },
      },
      rapportini: { select: { issues: true } },
    },
  });

  const corpus: InterventoCorpus[] = rows
    .map((i) => ({
      code: i.code,
      title: i.title,
      type: i.type,
      plantType: i.machine?.plantType ?? null,
      model: i.machine?.model ?? null,
      messages: i.conversations
        .flatMap((c) => c.messages)
        .map((m) => m.body?.trim() || "")
        .filter(Boolean)
        .slice(0, 40),
      issues: i.rapportini.map((r) => r.issues?.trim() || "").filter(Boolean),
    }))
    // scarta gli interventi senza alcun contenuto testuale (rumore)
    .filter((c) => c.messages.length > 0 || c.issues.length > 0);

  if (corpus.length === 0)
    return NextResponse.json({ error: "Nessun contenuto (chat/problematiche) da analizzare" }, { status: 400 });

  let report;
  try {
    report = await analyzeRecurringIssues(corpus);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore AI" }, { status: 502 });
  }

  const model = process.env.KNOWLEDGE_AI_MODEL || process.env.CHAT_AI_MODEL || "claude-haiku-4-5-20251001";
  const insight = await prisma.knowledgeInsight.create({
    data: {
      scope: "recurring-issues",
      model,
      data: report as object,
      interventiCount: corpus.length,
      generatedById: user.id,
      generatedByName: user.name,
    },
  });

  return NextResponse.json({ ok: true, insight });
}
