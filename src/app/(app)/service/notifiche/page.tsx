import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Notif = {
  id: string;
  tone: "alert" | "warn" | "ok" | "info";
  icon: string;
  title: string;
  desc: string;
  at: Date;
  href: string;
};

const TONE: Record<Notif["tone"], string> = {
  alert: "#dc2626",
  warn: "#f59e0b",
  ok: "#10b981",
  info: "#2f6aed",
};

export default async function NotifichePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  const [p1, recent, completed, chats] = await Promise.all([
    prisma.intervento.findMany({
      where: { priority: 1, status: "NUOVO", assignedTechId: null },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.intervento.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { name: true } } },
    }),
    prisma.intervento.findMany({
      where: { status: { in: ["COMPLETATO", "FATTURATO"] }, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 5,
      include: { customer: { select: { name: true } } },
    }),
    prisma.conversation.findMany({
      where: { lastMessageAt: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      include: { machine: { select: { code: true, job: true } } },
    }),
  ]);

  const items: Notif[] = [];
  for (const i of p1)
    items.push({
      id: "sla-" + i.id,
      tone: "alert",
      icon: "flag",
      title: `SLA a rischio: ${i.code}`,
      desc: `P1 da assegnare · ${i.customer?.name ?? i.title}`,
      at: i.createdAt,
      href: `/service/interventi/${i.id}`,
    });
  for (const i of recent)
    items.push({
      id: "new-" + i.id,
      tone: "info",
      icon: "wrench",
      title: `Intervento ${i.code}`,
      desc: `${i.title} · ${i.customer?.name ?? "—"}`,
      at: i.createdAt,
      href: `/service/interventi/${i.id}`,
    });
  for (const i of completed)
    items.push({
      id: "done-" + i.id,
      tone: "ok",
      icon: "check",
      title: `Completato ${i.code}`,
      desc: `${i.title} · ${i.customer?.name ?? "—"}`,
      at: i.completedAt!,
      href: `/service/interventi/${i.id}`,
    });
  for (const c of chats)
    items.push({
      id: "chat-" + c.id,
      tone: "info",
      icon: "sign",
      title: `Conversazione: ${c.contactName ?? c.title}`,
      desc: `${c.channel}${c.machine ? " · " + (c.machine.job || c.machine.code) : ""}`,
      at: c.lastMessageAt!,
      href: `/service/chat?conv=${c.id}`,
    });

  // dedup per id e ordina per data desc
  const seen = new Set<string>();
  const feed = items
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Notifiche</h1>
          <p>Alert SLA, interventi e conversazioni recenti</p>
        </div>
      </div>

      <div className="card">
        <ul className="mini-list">
          {feed.map((n) => (
            <li key={n.id}>
              <Link href={n.href} className="mini-row">
                <span className="notif-ic" style={{ background: TONE[n.tone] + "1f", color: TONE[n.tone] }}>
                  <Icon name={n.icon} size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  <div className="muted small">{n.desc}</div>
                </div>
                <span className="mono muted small">{fmtDate(n.at)}</span>
              </Link>
            </li>
          ))}
          {feed.length === 0 && <li className="muted small">Nessuna notifica.</li>}
        </ul>
      </div>
    </div>
  );
}
