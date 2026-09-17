"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { fmtDateTime } from "@/lib/format";

type Notif = {
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

const TONE: Record<string, string> = {
  alert: "#dc2626",
  warn: "#f59e0b",
  ok: "#10b981",
  info: "#2f6aed",
};

export default function NotificheClient({ initial }: { initial: Notif[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"tutte" | "nonlette">("tutte");

  const unread = items.filter((n) => !n.read).length;
  const shown = filter === "nonlette" ? items.filter((n) => !n.read) : items;

  async function markRead(ids?: string[]) {
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ids?.length ? { ids } : { all: true }),
    }).catch(() => null);
    router.refresh();
  }

  function open(n: Notif) {
    if (!n.read) void markRead([n.id]);
    if (n.href) router.push(n.href);
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Le mie notifiche</h1>
          <p>
            Assegnazioni di cantiere, cambi di squadra e riprogrammazioni che ti riguardano
            {unread > 0 ? ` · ${unread} non lette` : ""}
          </p>
        </div>
        <div className="detail-actions">
          <div className="tabs" style={{ border: "none", margin: 0 }}>
            <button
              className={"tab" + (filter === "tutte" ? " active" : "")}
              onClick={() => setFilter("tutte")}
            >
              Tutte
            </button>
            <button
              className={"tab" + (filter === "nonlette" ? " active" : "")}
              onClick={() => setFilter("nonlette")}
            >
              Non lette{unread > 0 ? ` (${unread})` : ""}
            </button>
          </div>
          {unread > 0 && (
            <button className="btn-ghost-sm" onClick={() => markRead()}>
              <Icon name="check" size={14} /> Segna tutte lette
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            {filter === "nonlette" ? "Nessuna notifica non letta." : "Nessuna notifica."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {shown.map((n) => {
            const color = TONE[n.tone] ?? TONE.info;
            const [intro, ...rest] = n.body.split("\n\n");
            const detail = rest.join("\n\n").trim();
            return (
              <div
                key={n.id}
                className="card"
                style={{
                  borderLeft: `3px solid ${color}`,
                  background: n.read ? undefined : "var(--accent-soft)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span className="notif-ic" style={{ background: color + "1f", color }}>
                    <Icon name={n.icon} size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong style={{ color: "var(--navy)", fontSize: 14 }}>{n.title}</strong>
                      <span className="muted small mono" style={{ whiteSpace: "nowrap" }}>
                        {fmtDateTime(n.createdAt)}
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-2)" }}>{intro}</p>
                    {detail && (
                      <pre className="notif-detail" style={{ margin: "10px 0 0" }}>
                        {detail}
                      </pre>
                    )}
                    <div className="detail-actions" style={{ marginTop: 10 }}>
                      {n.href && (
                        <button className="btn-ghost-sm" onClick={() => open(n)}>
                          <Icon name="arrow-right" size={14} /> Apri l&apos;intervento
                        </button>
                      )}
                      {!n.read && (
                        <button className="btn-ghost-sm" onClick={() => markRead([n.id])}>
                          <Icon name="check" size={14} /> Segna letta
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
