import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listNotifications, unreadCount, markRead } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Notifiche personali dell'utente loggato. Nessun permesso: ognuno vede e
 * segna come lette solo le proprie (il filtro per userId è nella query, non in
 * un parametro che il client potrebbe cambiare).
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  // ?count=1 → solo il numerino del pallino: è quello che il client richiama
  // in polling, e non serve spostare tutto l'elenco a ogni giro.
  if (searchParams.get("count")) {
    return NextResponse.json({ unread: await unreadCount(user.id) });
  }

  const limit = Number(searchParams.get("limit") ?? 30);
  const [items, unread] = await Promise.all([
    listNotifications(user.id, Number.isFinite(limit) ? limit : 30),
    unreadCount(user.id),
  ]);
  return NextResponse.json({ items, unread });
}

/** Segna come lette: `{ ids: [...] }` oppure `{ all: true }`. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const b = await req.json().catch(() => null);
  const ids = Array.isArray(b?.ids)
    ? (b.ids as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;
  if (!ids?.length && !b?.all)
    return NextResponse.json({ error: "Indicare ids o all" }, { status: 400 });

  const count = await markRead(user.id, ids);
  return NextResponse.json({ ok: true, count, unread: await unreadCount(user.id) });
}
