"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { Flag } from "@/components/Icon";
import { STATUS_META, STATUS_ORDER } from "@/lib/domain";
import { hasKit, KITS } from "@/lib/kits";
import { containerType } from "@/lib/allestimento";
import type { MachineStatus } from "@prisma/client";

type M = {
  id: string;
  code: string;
  job: string;
  plantType: string | null;
  model: string;
  customer: string;
  country: string;
  countryCode: string;
  year: number;
  status: MachineStatus;
  progress: number;
  tiranteGiunto: boolean;
  filtroMaggiorato: boolean;
  /** Tipo container dalla scheda M5.17 (null = scheda non ancora compilata). */
  containerType: string | null;
};

export default function MachinesList({
  machines,
  canCreate,
  canImport,
  initialQuery = "",
}: {
  machines: M[];
  canCreate: boolean;
  canImport: boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  // L elenco si apre sulle macchine IN PRODUZIONE: e il quadro che serve ogni
  // giorno (a che punto siamo). Arrivando da una ricerca si parte da "tutte",
  // altrimenti una macchina gia spedita non si troverebbe.
  const [filter, setFilter] = useState<string>(initialQuery ? "all" : "PRODUCTION");

  const filtered = useMemo(
    () =>
      machines.filter((m) => {
        if (filter !== "all" && m.status !== filter) return false;
        if (!q) return true;
        const hay = [m.code, m.job, m.customer, m.country, m.model, m.plantType || ""]
          .join(" ")
          .toLowerCase();
        return hay.includes(q.toLowerCase());
      }),
    [machines, q, filter]
  );

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Macchine</h1>
          <p>
            {machines.length} fascicoli · dalla genesi alla rottamazione
          </p>
        </div>
        <div className="row-actions">
          {canImport && (
            <Link className="btn-ghost" href="/import">
              <Icon name="upload" size={15} /> Import
            </Link>
          )}
          {canCreate && (
            <Link className="btn-primary" href="/macchine/nuova">
              <Icon name="plus" size={15} /> Nuova macchina
            </Link>
          )}
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input
            placeholder="Cerca matricola, job, cliente, paese…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="filters">
          <button
            className={"chip-btn" + (filter === "all" ? " active" : "")}
            onClick={() => setFilter("all")}
          >
            Tutte
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={"chip-btn" + (filter === s ? " active" : "")}
              onClick={() => setFilter(s)}
            >
              <span className="badge-dot" style={{ background: STATUS_META[s].color }} />
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      <div className="card no-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID Fascicolo</th>
                <th>Job</th>
                <th>Tipologia</th>
                <th>Modello</th>
                <th title="Tipo container dalla scheda di allestimento M5.17">Tipo container</th>
                {KITS.map((k) => (
                  <th key={k.key} title={k.hint}>
                    {k.column}
                  </th>
                ))}
                <th>Cliente</th>
                <th>Paese</th>
                <th>Anno</th>
                <th>Stato</th>
                <th>Avanzamento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const ct = containerType(m.containerType);
                return (
                <tr
                  key={m.id}
                  className="clickable"
                  // Colore di riga per tipo container: in un elenco di 195
                  // fascicoli quasi uguali e' l'unico modo per distinguerli
                  // senza leggere riga per riga.
                  style={ct ? { borderLeft: `4px solid ${ct.color}`, background: `${ct.color}0d` } : undefined}
                  onClick={() => router.push(`/macchine/${m.code}`)}
                >
                  <td className="mono">{m.code}</td>
                  <td className="mono muted">{m.job}</td>
                  <td>{m.plantType || <span className="muted">—</span>}</td>
                  <td>{m.model}</td>
                  <td>
                    {ct ? (
                      <span className="ctype-badge" style={{ background: `${ct.color}1f`, color: ct.color }}>
                        {ct.short}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {KITS.map((k) => (
                    <td key={k.key} style={{ textAlign: "center" }}>
                      {hasKit(k.key, m.plantType) ? (
                        <input
                          type="checkbox"
                          checked={m[k.key]}
                          readOnly
                          tabIndex={-1}
                          aria-label={`${k.label}: ${m[k.key] ? "sì" : "no"}`}
                          style={{ pointerEvents: "none", accentColor: "var(--accent)", width: 15, height: 15 }}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  ))}
                  <td>{m.customer}</td>
                  <td>
                    <div className="country-cell">
                      <Flag code={m.countryCode} /> <span>{m.country}</span>
                    </div>
                  </td>
                  <td className="mono">{m.year}</td>
                  <td>
                    <span className="badge">
                      <span
                        className="badge-dot"
                        style={{ background: STATUS_META[m.status].color }}
                      />
                      {STATUS_META[m.status].label}
                    </span>
                  </td>
                  <td>
                    <div className="row-progress">
                      <div className="row-progress-bar">
                        <span
                          style={{
                            width: m.progress + "%",
                            background: STATUS_META[m.status].color,
                          }}
                        />
                      </div>
                      <span className="mono small">{m.progress}%</span>
                    </div>
                  </td>
                  <td>
                    <Icon name="chev-right" size={16} color="var(--muted)" />
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="empty">
                    Nessuna macchina trovata.
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
