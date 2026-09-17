import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

/**
 * Notifiche personali: pallino rosso col numero sull'app + e-mail.
 *
 * Questo modulo costruisce e salva le notifiche. L'invio della mail sta in
 * `notifyMail.ts` e gira DOPO la risposta HTTP (`after()`): assegnare un
 * intervento non deve fallire — né rallentare — perché Gmail è lento o la
 * casella non è collegata.
 */

export type NotifKind =
  | "INTERVENTO_ASSEGNATO"
  | "INTERVENTO_SQUADRA"
  | "INTERVENTO_RIPROGRAMMATO"
  | "INTERVENTO_RIMOSSO"
  | "POS_DA_CARICARE" // intervento appena creato: il P.O.S. non c'e' ancora
  | "POS_DA_VALIDARE"; // file caricato: il responsabile lo deve firmare

export type NotifTone = "info" | "ok" | "warn" | "alert";

export type NewNotification = {
  userId: string;
  kind: NotifKind;
  title: string;
  body: string;
  tone?: NotifTone;
  icon?: string;
  href?: string | null;
  interventoId?: string | null;
  machineId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  emailTo?: string | null;
};

/** Scrive le notifiche e restituisce gli id creati (per l'invio mail successivo). */
export async function createNotifications(items: NewNotification[]): Promise<string[]> {
  if (!items.length) return [];
  const ids: string[] = [];
  for (const n of items) {
    const row = await prisma.notification.create({
      data: {
        userId: n.userId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        tone: n.tone ?? "info",
        icon: n.icon ?? "bell",
        href: n.href ?? null,
        interventoId: n.interventoId ?? null,
        machineId: n.machineId ?? null,
        actorId: n.actorId ?? null,
        actorName: n.actorName ?? null,
        emailTo: n.emailTo ?? null,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

/** Quante notifiche non lette ha l'utente: è il numerino sul pallino. */
export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export type NotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tone: string;
  icon: string;
  href: string | null;
  interventoId: string | null;
  read: boolean;
  actorName: string | null;
  createdAt: string;
};

/** Ultime notifiche dell'utente, più recenti in testa. */
export async function listNotifications(userId: string, limit = 30): Promise<NotificationView[]> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    tone: r.tone,
    icon: r.icon,
    href: r.href,
    interventoId: r.interventoId,
    read: r.readAt !== null,
    actorName: r.actorName,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Segna come lette: gli id indicati, oppure tutte. Solo le proprie. */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const where: Prisma.NotificationWhereInput = { userId, readAt: null };
  if (ids?.length) where.id = { in: ids };
  const res = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return res.count;
}
