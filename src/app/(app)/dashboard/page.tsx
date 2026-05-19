import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_META, STATUS_ORDER, PHASE_META } from "@/lib/domain";
import Icon, { Flag } from "@/components/Icon";
import { fmtDate } from "@/lib/format";
import { userCaps } from "@/lib/caps";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { "machine.create": canCreate } = await userCaps("machine.create");
  const machines = await prisma.machine.findMany({ orderBy: { createdAt: "desc" } });
  const recent = await prisma.diaryEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { machine: true },
  });

  const count = (s: string) => machines.filter((m) => m.status === s).length;
  const stats = [
    { label: "In produzione", value: count("PRODUCTION"), icon: "machines", tone: "#1d6fb8" },
    { label: "In collaudo", value: count("TESTING"), icon: "check", tone: "#f59e0b" },
    { label: "Spedite / transito", value: count("SHIPPED"), icon: "truck", tone: "#8b5cf6" },
    {
      label: "In esercizio (campo)",
      value: count("INSTALLED") + count("MAINTENANCE"),
      icon: "flag",
      tone: "#10b981",
    },
  ];

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Dashboard</h1>
          <p>Stato della flotta produttiva e in esercizio</p>
        </div>
        {canCreate && (
          <Link className="btn-primary" href="/macchine/nuova">
            <Icon name="plus" size={15} /> Nuova macchina
          </Link>
        )}
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
            <div className="stat-sub">fascicoli</div>
          </div>
        ))}
      </div>

      <div className="grid-two">
        <section className="card">
          <div className="card-header">
            <h3>Pipeline produzione</h3>
            <Link className="btn-ghost-sm" href="/macchine">
              Vedi tutte
            </Link>
          </div>
          <div className="pipeline">
            {STATUS_ORDER.map((s) => {
              const meta = STATUS_META[s];
              const items = machines.filter((m) => m.status === s);
              return (
                <div className="pipe-col" key={s}>
                  <div className="pipe-col-h">
                    <span className="badge-dot" style={{ background: meta.color }} />
                    <span>{meta.label}</span>
                    <span className="muted mono">{items.length}</span>
                  </div>
                  <div className="pipe-cards">
                    {items.map((m) => (
                      <Link key={m.id} className="pipe-card" href={`/macchine/${m.code}`}>
                        <div className="pipe-card-id mono">{m.code}</div>
                        <div className="pipe-card-customer">{m.customer}</div>
                        <div className="pipe-card-meta">
                          <Flag code={m.countryCode} />
                          <span className="muted small">{m.country}</span>
                        </div>
                        <div className="pipe-progress">
                          <span style={{ width: m.progress + "%", background: meta.color }} />
                        </div>
                      </Link>
                    ))}
                    {items.length === 0 && <div className="empty-pipe small">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Attività recenti</h3>
          </div>
          <ul className="activity-list">
            {recent.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/macchine/${e.machine.code}`}
                  className="activity-row"
                  style={{ color: "inherit" }}
                >
                  <div
                    className="activity-rail"
                    style={{ background: PHASE_META[e.phase].color }}
                  />
                  <div className="activity-body">
                    <div className="activity-title">{e.title}</div>
                    <div className="activity-meta muted small">
                      <span className="mono">{fmtDate(e.date)}</span>
                      <span>·</span>
                      <span className="mono">{e.machine.code}</span>
                      <span>·</span>
                      <span>{e.actorName}</span>
                    </div>
                  </div>
                  <span
                    className="phase-chip"
                    style={{
                      background: PHASE_META[e.phase].color + "22",
                      color: PHASE_META[e.phase].color,
                    }}
                  >
                    {PHASE_META[e.phase].label}
                  </span>
                </Link>
              </li>
            ))}
            {recent.length === 0 && <li className="empty">Nessuna attività registrata.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
