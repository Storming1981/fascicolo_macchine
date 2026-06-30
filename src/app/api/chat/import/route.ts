import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { parseChatExport } from "@/lib/chatImport";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.import")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const provider = String(form.get("provider") || "whatsapp") as "whatsapp" | "telegram";
  const ourName = String(form.get("ourName") || "").trim().toLowerCase();
  const titleIn = String(form.get("title") || "").trim();
  const customerId = String(form.get("customerId") || "").trim() || null;
  const machineId = String(form.get("machineId") || "").trim() || null;
  const interventoId = String(form.get("interventoId") || "").trim() || null;

  if (!(file instanceof File) || file.size === 0)
    return NextResponse.json({ error: "File mancante" }, { status: 400 });
  if (provider !== "whatsapp" && provider !== "telegram")
    return NextResponse.json({ error: "Provider non valido" }, { status: 400 });

  const content = await file.text();
  const parsed = parseChatExport(provider, content);
  if (parsed.messages.length === 0)
    return NextResponse.json(
      { error: "Nessun messaggio riconosciuto nel file (formato non valido?)" },
      { status: 422 }
    );

  const title =
    titleIn ||
    parsed.title ||
    parsed.participants.find((p) => p.toLowerCase() !== ourName) ||
    `Import ${provider}`;
  const contactName = parsed.participants.find((p) => p.toLowerCase() !== ourName) ?? null;

  const dates = parsed.messages.map((m) => m.sentAt).filter((d): d is Date => !!d);
  const lastMessageAt = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

  const conv = await prisma.conversation.create({
    data: {
      title,
      channel: provider,
      contactName,
      customerId,
      machineId,
      interventoId,
      lastMessageAt,
    },
  });

  // ordine cronologico crescente
  const ordered = [...parsed.messages].sort(
    (a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0)
  );
  await prisma.message.createMany({
    data: ordered.map((m) => ({
      conversationId: conv.id,
      direction: ourName && m.authorName.toLowerCase() === ourName ? ("OUT" as const) : ("IN" as const),
      authorName: m.authorName,
      body: m.hasMedia && !m.body ? "📎 [media allegato]" : m.body,
      source: "import",
      sentAt: m.sentAt ?? new Date(),
    })),
  });

  return NextResponse.json({ ok: true, id: conv.id, imported: ordered.length });
}
