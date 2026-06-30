import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import {
  INTERVENTO_STATUS_META,
  INTERVENTO_STATUS_ORDER,
  PRIORITY_META,
} from "@/lib/domain";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ServiceDashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [all, p1Pending, inCorso, doneMonth, techs, recent, chats] = await Promise.all([
    prisma.intervento.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.intervento.count({ where: { priority: 1, status: "NUOVO", assignedTechId: null } }),
    prisma.intervento.count({ where: { status: "IN_CORSO" } }),
    prisma.intervento.count({ where: { status: { in: ["COMPLETATO", "FATTURATO"] }, completedAt: { gte: monthStart } } }),
    prisma.user.count({ where: { active: true, zona: { not: null } } }),
    prisma.intervento.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { name: true } }, machine: { select: { code: true, job: true } } },
    }),
    prisma.conversation.findMany({
      orderBy: [{ lastMessageAt: "desc" }],
      take: 5,
      include: { machine: { select: { code: true, job: true } } },
    }),
  ]);

  const countBy = (s: string) => all.find((g) => g.status === s)?._count._all ?? 0;
  const aperti = all.filter((g) => g.status !== "FATTURATO").reduce((n, g) => n + g._count._all, 0);

  const stats = [
    { label: "Interventi aperti", value: aperti, icon: "wrench", tone: "#2f6aed" },
    { label: "P1 da assegnare", value: p1Pending, icon: "flag", tone: "#dc2626" },
    { label: "In corso", value: inCorso, icon: "clock", tone: "#f59e0b" },
    { label: "Completati (mese)", value: doneMonth, icon: "check", tone: "#10b981" },
  ];

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Service</h1>
          <p>Panoramica interventi in cantiere · {techs} tecnici operativi</p>
        </div>
        <Link className="btn-primary" href="/service/interventi">
          <Icon name="wrench" size={15} /> Vai agli interventi
        </Link>
      </div>

      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-card-top">
              <div className="stat-label">{s.label}</div>
              <div className="stat-icon" style={{ background: s.tone + "1f", color: s.tone }}>
                <Icon name={s.icon} size={20} />
              </div>
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">interventi</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Pipeline interventi</h3>
          <Link className="btn-ghost-sm" href="/service/interventi">Vedi tutti</Link>
        </div>
        <div className="svc-pipeline">
          {INTERVENTO_STATUS_ORDER.map((s) => {
            const meta = INTERVENTO_STATUS_META[s];
            return (
              <div className="svc-pipe" key={s}>
                <div className="svc-pipe-top">
                  <span className="badge-dot" style={{ background: meta.color }} />
                  <span>{meta.label}</span>
                </div>
                <div className="svc-pipe-count mono">{countBy(s)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid-two">
        <section className="card">
          <div className="card-header">
            <h3>Interventi recenti</h3>
            <Link className="btn-ghost-sm" href="/service/interventi">Tutti</Link>
          </div>
          <ul className="mini-list">
            {recent.map((i) => {
              const meta = INTERVENTO_STATUS_META[i.status];
              const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
              return (
                <li key={i.id}>
                  <Link href={`/service/interventi/${i.id}`} className="mini-row">
                    <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>{prio.short}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{i.title}</span>
                    <span className="muted small">{i.machine?.job || i.machine?.code || i.customer?.name || ""}</span>
                    <span className="status-chip" style={{ background: meta.color + "22", color: meta.color }}>{meta.label}</span>
                  </Link>
                </li>
              );
            })}
            {recent.length === 0 && <li className="muted small">Nessun intervento.</li>}
          </ul>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Conversazioni recenti</h3>
            <Link className="btn-ghost-sm" href="/service/chat">Apri chat</Link>
          </div>
          <ul className="mini-list">
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/service/chat?conv=${c.id}`} className="mini-row">
                  <span style={{ flex: 1, fontWeight: 600 }}>{c.contactName ?? c.title}</span>
                  <span className="muted small">{c.channel}{c.machine ? " · " + (c.machine.job || c.machine.code) : ""}</span>
                  <span className="mono muted small">{c.lastMessageAt ? fmtDate(c.lastMessageAt) : ""}</span>
                </Link>
              </li>
            ))}
            {chats.length === 0 && <li className="muted small">Nessuna conversazione.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
