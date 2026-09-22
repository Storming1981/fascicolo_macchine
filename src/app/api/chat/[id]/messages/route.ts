import { NextResponse, after } from "next/server";
import { loadInterventoBrief, buildChatNotices } from "@/lib/interventoNotify";
import { createNotifications } from "@/lib/notifications";
import { deliverNotifications } from "@/lib/notifyDeliver";
import { absoluteUrl } from "@/lib/absoluteUrl";
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

  // Aprire la chat vale come averla letta: gli avvisi di messaggio su questa
  // conversazione si spengono da soli. Altrimenti si leggerebbero due volte le
  // stesse righe — prima in chat e poi sulla campanella per toglierle.
  // Sta qui, nel caricamento dei messaggi, e non nel client: cosi' vale per il
  // desktop, per l'app Campo e per qualunque schermata futura.
  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      kind: "CHAT_MESSAGGIO",
      readAt: null,
      href: `/vai/chat/${id}`,
    },
    data: { readAt: new Date() },
  });

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


  // ── Avviso alla squadra ───────────────────────────────────────────
  // Una chat senza avviso e' una chat che nessuno legge: il messaggio resta li'
  // finche' qualcuno per caso apre l'intervento.
  if (conv.interventoId) {
    try {
      const brief = await loadInterventoBrief(conv.interventoId);
      if (brief) {
        const notices = await buildChatNotices(
          brief,
          id,
          { id: user.id, name: user.name },
          body || "📷 foto",
          false
        );
        if (notices.length) {
          const ids = await createNotifications(notices.map((n) => n.notification));
          const base = absoluteUrl(req, "");
          after(async () => {
            await deliverNotifications(ids, notices, user.id, base);
          });
        }
      }
    } catch (e) {
      // Il messaggio e' gia' salvato: un avviso mancato non lo annulla.
      console.error("[notifiche] messaggio chat", id, e);
    }
  }

  return NextResponse.json({ ok: true });
}
