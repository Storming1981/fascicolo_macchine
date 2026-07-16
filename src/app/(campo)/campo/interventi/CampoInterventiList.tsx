"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import {
  INTERVENTO_STATUS_META,
  PRIORITY_META,
  interventoTypeMeta,
} from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

export type CampoItem = {
  id: string;
  code: string;
  title: string;
  status: InterventoStatus;
  type: string;
  priority: number;
  customer: string | null;
  site: string | null;
  machineJob: string | null;
};

const GROUPS: { key: string; label: string; test: (s: InterventoStatus) => boolean }[] = [
  { key: "aperti", label: "Da fare", test: (s) => s === "NUOVO" || s === "PIANIFICATO" || s === "IN_CORSO" },
  { key: "chiusi", label: "Chiusi", test: (s) => s === "COMPLETATO" || s === "FATTURATO" },
  { key: "tutti", label: "Tutti", test: () => true },
];

export default function CampoInterventiList({ items, own }: { items: CampoItem[]; own: boolean }) {
  const [g, setG] = useState("aperti");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const grp = GROUPS.find((x) => x.key === g) ?? GROUPS[2];
    const term = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        grp.test(i.status) &&
        (!term ||
          i.title.toLowerCase().includes(term) ||
          i.code.toLowerCase().includes(term) ||
          (i.customer ?? "").toLowerCase().includes(term) ||
          (i.machineJob ?? "").toLowerCase().includes(term))
    );
  }, [items, g, q]);

  return (
    <div className="campo-view">
      <div className="campo-head">
        <h1>Interventi</h1>
        <p>{own ? "I tuoi interventi assegnati" : `${items.length} interventi`}</p>
      </div>

      <div className="campo-search">
        <Icon name="search" size={16} color="var(--muted)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca titolo, job, cliente…" />
      </div>

      <div className="campo-segments">
        {GROUPS.map((x) => (
          <button key={x.key} className={"campo-seg" + (g === x.key ? " active" : "")} onClick={() => setG(x.key)}>
            {x.label}
            <span className="mono">{items.filter((i) => x.test(i.status)).length}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="campo-empty">Nessun intervento.</div>
      ) : (
        <div className="campo-cards">
          {filtered.map((i) => {
            const st = INTERVENTO_STATUS_META[i.status];
            const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
            const tm = interventoTypeMeta(i.type);
            return (
              <Link
                key={i.id}
                href={`/campo/interventi/${i.id}`}
                className="campo-card"
                style={{ borderLeft: `5px solid ${tm.color}` }}
              >
                <div className="campo-card-top">
                  <span className="mono muted">{i.code}</span>
                  <span className="type-chip" style={{ background: tm.color + "1f", color: tm.color }}>
                    {tm.label}
                  </span>
                  {i.priority === 1 && (
                    <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>
                      P1
                    </span>
                  )}
                </div>
                <div className="campo-card-title">{i.title}</div>
                <div className="campo-card-meta">
                  {i.machineJob && (
                    <span>
                      <Icon name="machines" size={13} /> <span className="mono">{i.machineJob}</span>
                    </span>
                  )}
                  {i.customer && (
                    <span>
                      <Icon name="people" size={13} /> {i.customer}
                    </span>
                  )}
                </div>
                <div className="campo-card-foot">
                  <span className="status-chip" style={{ background: st.color + "22", color: st.color }}>
                    {st.label}
                  </span>
                  <Icon name="chev-right" size={18} color="var(--muted)" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
