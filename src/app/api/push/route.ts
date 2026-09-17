import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicVapidKey, isPushConfigured, sendPushToUser } from "@/lib/push";
import { unreadCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Iscrizione Web Push del dispositivo corrente.
 *
 * GET    → chiave pubblica VAPID + se questo dispositivo è già iscritto
 * POST   → iscrive (upsert su endpoint) · `{test:true}` manda una prova
 * DELETE → disiscrive questo endpoint
 *
 * Nessun permesso: ognuno gestisce i propri dispositivi.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");
  const subscribed = endpoint
    ? (await prisma.pushSubscription.count({ where: { endpoint, userId: user.id } })) > 0
    : false;

  return NextResponse.json({
    configured: isPushConfigured(),
    key: publicVapidKey(),
    subscribed,
    devices: await prisma.pushSubscription.count({ where: { userId: user.id } }),
  });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!isPushConfigured())
    return NextResponse.json({ error: "Web Push non configurato sul server" }, { status: 503 });

  const b = await req.json().catch(() => null);

  // Prova immediata: l'utente deve poter verificare da solo che funziona,
  // senza aspettare che qualcuno gli assegni un cantiere.
  if (b?.test) {
    const sent = await sendPushToUser(user.id, {
      title: "Notifiche attive",
      body: "Riceverai qui gli avvisi di cantiere, anche ad app chiusa.",
      url: "/notifiche",
      tag: "zato-test",
      unread: await unreadCount(user.id),
    });
    return NextResponse.json({ ok: sent > 0, sent });
  }

  const endpoint = typeof b?.endpoint === "string" ? b.endpoint : null;
  const p256dh = typeof b?.keys?.p256dh === "string" ? b.keys.p256dh : null;
  const auth = typeof b?.keys?.auth === "string" ? b.keys.auth : null;
  if (!endpoint || !p256dh || !auth)
    return NextResponse.json({ error: "Iscrizione non valida" }, { status: 400 });

  // Upsert su endpoint: se il dispositivo si reiscrive (o cambia utente sullo
  // stesso browser) si aggiorna la riga invece di accumularne una nuova.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh, auth, failCount: 0, userAgent: req.headers.get("user-agent") },
    create: { userId: user.id, endpoint, p256dh, auth, userAgent: req.headers.get("user-agent") },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const b = await req.json().catch(() => null);
  const endpoint = typeof b?.endpoint === "string" ? b.endpoint : null;
  if (!endpoint) return NextResponse.json({ error: "Endpoint mancante" }, { status: 400 });

  // Solo le proprie: l'endpoint da solo non deve permettere di disiscrivere altri.
  const res = await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true, removed: res.count });
}
