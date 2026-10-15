"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { fmtDate, fmtDateTime, fmtHM } from "@/lib/format";
import { interventoTypeMeta } from "@/lib/domain";

export type RapportinoRow = {
  id: string;
  date: string;
  workDescription: string | null;
  issues: string | null;
  hours: number | null;
  operators: string[];
  techName: string | null;
  clientName: string | null;
  closed: boolean;
  sentAt: string | null;
  sentTo: string | null;
  attachments: number;
  interventoId: string;
  interventoCode: string;
  interventoTitle: string;
  interventoType: string;
  commessa: string | null;
  customer: string | null;
  site: string | null;
  machine: string | null;
};

type Stato = "all" | "draft" | "signed" | "unsent";
type Periodo = "all" | "7" | "30" | "month";

const STATI: { key: Stato; label: string; color?: string }[] = [
  { key: "all", label: "Tutti" },
  { key: "draft", label: "Bozze", color: "#f59e0b" },
  { key: "signed", label: "Firmati", color: "#10b981" },
  { key: "unsent", label: "Firmati non inviati", color: "#dc2626" },
];

const PERIODI: { key: Periodo; label: string }[] = [
  { key: "all", label: "Sempre" },
  { key: "7", label: "Ultimi 7 giorni" },
  { key: "30", label: "Ultimi 30 giorni" },
  { key: "month", label: "Questo mese" },
];

function inPeriodo(iso: string, p: Periodo): boolean {
  if (p === "all") return true;
  const d = new Date(iso);
  const now = new Date();
  if (p === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (Number(p) - 1));
  return d >= from;
}

export default function RapportiniList({
  rapportini,
  initialQuery = "",
}: {
  rapportini: RapportinoRow[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  useEffect(() => setQ(initialQuery), [initialQuery]);
  const [stato, setStato] = useState<Stato>("all");
  const [periodo, setPeriodo] = useState<Periodo>("all");

  const counts = useMemo(
    () => ({
      all: rapportini.length,
      draft: rapportini.filter((r) => !r.closed).length,
      signed: rapportini.filter((r) => r.closed).length,
      unsent: rapportini.filter((r) => r.closed && !r.sentAt).length,
    }),
    [rapportini]
  );

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rapportini.filter((r) => {
      if (stato === "draft" && r.closed) return false;
      if (stato === "signed" && !r.closed) return false;
      if (stato === "unsent" && (!r.closed || r.sentAt)) return false;
      if (!inPeriodo(r.date, periodo)) return false;
      if (!words.length) return true;
      const hay = [
        r.interventoCode,
        r.interventoTitle,
        r.commessa,
        r.customer,
        r.site,
        r.machine,
        r.techName,
        r.clientName,
        r.workDescription,
        r.issues,
        fmtDate(r.date),
        ...r.operators,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rapportini, q, stato, periodo]);

  const totalHours = filtered.reduce((s, r) => s + (r.hours ?? 0), 0);
  const openRow = (r: RapportinoRow) =>
    router.push(`/service/interventi/${r.interventoId}#rap-${r.id}`);

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Rapportini</h1>
          <p>
            {rapportini.length} rapportini giornalieri di tutti gli interventi
            {filtered.length !== rapportini.length && ` · ${filtered.length} mostrati`}
            {totalHours > 0 && ` · ${fmtHM(totalHours)} totali`}
          </p>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input
            placeholder="Cerca intervento, cliente, commessa, macchina, tecnico, testo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="input"
          style={{ width: "auto" }}
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value as Periodo)}
          aria-label="Periodo"
        >
          {PERIODI.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="filters">
          {STATI.map((s) => (
            <button
              key={s.key}
              className={"chip-btn" + (stato === s.key ? " active" : "")}
              onClick={() => setStato(s.key)}
            >
              {s.color && <span className="badge-dot" style={{ background: s.color }} />}
              {s.label}
              <span className="chip-n">{counts[s.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card no-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Intervento</th>
                <th>Cliente · Cantiere</th>
                <th>Macchina</th>
                <th>Lavori svolti</th>
                <th>Operatori</th>
                <th>Ore</th>
                <th>Stato</th>
                <th>Inviato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const tm = interventoTypeMeta(r.interventoType);
                const ops = r.operators.length ? r.operators : r.techName ? [r.techName] : [];
                return (
                  <tr key={r.id} className="clickable" onClick={() => openRow(r)}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(r.date)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div className="mono" style={{ fontWeight: 600 }}>
                        {r.interventoCode}
                      </div>
                      <span className="badge" style={{ marginTop: 3 }}>
                        <span className="badge-dot" style={{ background: tm.color }} />
                        {tm.label}
                      </span>
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div>{r.customer ?? "—"}</div>
                      {(r.site || r.commessa) && (
                        <div className="muted small">
                          {[r.site, r.commessa && `comm. ${r.commessa}`].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="mono">{r.machine ?? "—"}</td>
                    <td style={{ minWidth: 220, maxWidth: 360 }}>
                      <div
                        className="small"
                        style={{
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                        title={r.workDescription ?? ""}
                      >
                        {r.workDescription || <span className="muted">—</span>}
                      </div>
                      {r.issues && (
                        <div className="small" style={{ color: "#b45309", marginTop: 2 }} title={r.issues}>
                          ⚠ Problematiche segnalate
                        </div>
                      )}
                    </td>
                    <td className="small" style={{ minWidth: 140 }}>
                      {ops.length ? ops.join(", ") : <span className="muted">—</span>}
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {r.hours ? fmtHM(r.hours) : "—"}
                    </td>
                    <td>
                      {r.closed ? (
                        <span className="badge" title={r.clientName ? `Firmato dal cliente: ${r.clientName}` : undefined}>
                          <span className="badge-dot" style={{ background: "#10b981" }} />
                          Firmato
                        </span>
                      ) : (
                        <span className="badge">
                          <span className="badge-dot" style={{ background: "#f59e0b" }} />
                          Bozza
                        </span>
                      )}
                    </td>
                    <td className="small" style={{ whiteSpace: "nowrap" }} title={r.sentTo ?? undefined}>
                      {r.sentAt ? fmtDateTime(r.sentAt) : <span className="muted">—</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      <a
                        className="btn-ghost-sm"
                        href={`/api/interventi/${r.interventoId}/rapportino/${r.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        title="Apri il PDF del rapportino"
                      >
                        <Icon name="doc" size={13} /> PDF
                      </a>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted small" style={{ textAlign: "center", padding: 28 }}>
                    Nessun rapportino corrisponde ai filtri.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
