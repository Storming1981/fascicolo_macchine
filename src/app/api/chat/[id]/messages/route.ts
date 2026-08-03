import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/uploads";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      machine: { select: { id: true, code: true, job: true } },
      intervento: { select: { id: true, code: true, title: true } },
      // operatori ZATO: vedono TUTTI i messaggi (interni + pubblici)
      messages: { orderBy: { sentAt: "asc" } },
    },
  });
  if (!conv) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "chat.send")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, interventoId: true, machineId: true, intervento: { select: { code: true } }, machine: { select: { code: true } } },
  });
  if (!conv) return NextResponse.json({ error: "Conversazione non trovata" }, { status: 404 });

  // Supporta JSON (solo testo) o multipart (testo + foto).
  const ctype = req.headers.get("content-type") || "";
  let body = "";
  let visibility: "INTERNAL" | "PUBLIC" = "INTERNAL";
  let photoPath: string | null = null;

  const scope = conv.machine?.code
    ? `${conv.machine.code}/chat`
    : `service/${conv.intervento?.code ?? conv.id}/chat`;

  if (ctype.includes("multipart/form-data")) {
    const fd = await req.formData();
    body = String(fd.get("body") || "").trim();
    if (String(fd.get("visibility") || "") === "PUBLIC") visibility = "PUBLIC";
    const file = fd.get("photo");
    if (file instanceof File && file.size > 0) {
      const saved = await saveFile(file, scope);
      photoPath = saved.path;
    }
  } else {
    const b = await req.json().catch(() => null);
    body = typeof b?.body === "string" ? b.body.trim() : "";
    if (b?.visibility === "PUBLIC") visibility = "PUBLIC";
  }

  if (!body && !photoPath) return NextResponse.json({ error: "Messaggio vuoto" }, { status: 400 });

  const now = new Date();
  await prisma.message.create({
    data: {
      conversationId: id,
      direction: "OUT",
      visibility,
      authorId: user.id,
      authorName: user.name,
      body: body || null,
      photoPath,
      source: "native",
      sentAt: now,
    },
  });
  await prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } });

  // La foto confluisce nel corpus dell'intervento/fascicolo (come le altre foto).
  if (photoPath && conv.interventoId) {
    await prisma.photo.create({
      data: {
        interventoId: conv.interventoId,
        machineId: conv.machineId,
        path: photoPath,
        category: "chat",
        caption: body || null,
        authorName: user.name,
        authorId: user.id,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
