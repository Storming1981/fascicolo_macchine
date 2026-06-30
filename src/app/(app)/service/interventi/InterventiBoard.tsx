"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import {
  INTERVENTO_STATUS_META,
  INTERVENTO_STATUS_ORDER,
  PRIORITY_META,
  initials,
} from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

export type InterventoRow = {
  id: string;
  code: string;
  title: string;
  status: InterventoStatus;
  priority: number;
  channel: string | null;
  customer: string | null;
  site: string | null;
  machineCode: string | null;
  machineJob: string | null;
  tech: string | null;
  assignedTechId: string | null;
  scheduledStart: string | null;
};

type Tech = { id: string; name: string; zona: string | null };
export type CustomerOpt = {
  id: string;
  name: string;
  sites: { id: string; name: string }[];
  machines: { id: string; code: string; job: string; model: string }[];
};

const FILTERS: { key: string; label: string; test: (i: InterventoRow) => boolean }[] = [
  { key: "tutti", label: "Tutti", test: () => true },
  { key: "p1", label: "Solo P1", test: (i) => i.priority === 1 },
  { key: "aperti", label: "Aperti", test: (i) => i.status !== "FATTURATO" },
  { key: "daassegnare", label: "Da assegnare", test: (i) => !i.assignedTechId },
];

export default function InterventiBoard({
  interventi,
  techs,
  customers,
  canCreate,
  canEdit,
}: {
  interventi: InterventoRow[];
  techs: Tech[];
  customers: CustomerOpt[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [filtro, setFiltro] = useState("tutti");
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [localStatus, setLocalStatus] = useState<Record<string, InterventoStatus>>({});

  const effInterventi = useMemo(
    () => interventi.map((i) => (localStatus[i.id] ? { ...i, status: localStatus[i.id] } : i)),
    [interventi, localStatus]
  );
  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filtro) ?? FILTERS[0];
    return effInterventi.filter(f.test);
  }, [effInterventi, filtro]);

  async function changeStatus(id: string, status: InterventoStatus) {
    const prev = interventi.find((i) => i.id === id)?.status;
    if (prev === status) return;
    setBusy(id);
    setLocalStatus((s) => ({ ...s, [id]: status })); // ottimistico
    try {
      const res = await fetch(`/api/interventi/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setLocalStatus((s) => {
          const c = { ...s };
          delete c[id];
          return c;
        });
      } else {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Interventi</h1>
          <p>
            {interventi.length} interventi ·{" "}
            {interventi.filter((i) => i.priority === 1).length} P1 ·{" "}
            {interventi.filter((i) => !i.assignedTechId).length} da assegnare
          </p>
        </div>
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} /> Nuovo intervento
          </button>
        )}
      </div>

      <div className="board-toolbar">
        <div className="seg-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={"seg-tab" + (filtro === f.key ? " active" : "")}
              onClick={() => setFiltro(f.key)}
            >
              {f.label}
              <span className="mono muted">{interventi.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <div className="view-switch">
          {(["kanban", "lista"] as const).map((v) => (
            <button
              key={v}
              className={"view-switch-btn" + (view === v ? " active" : "")}
              onClick={() => setView(v)}
            >
              <Icon name={v === "kanban" ? "table" : "doc"} size={14} />
              {v === "kanban" ? "Kanban" : "Lista"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">Nessun intervento per questo filtro.</div>
      ) : view === "kanban" ? (
        <Kanban
          interventi={filtered}
          canEdit={canEdit}
          busy={busy}
          onStatus={changeStatus}
        />
      ) : (
        <Lista interventi={filtered} />
      )}

      {showNew && (
        <NewInterventoModal techs={techs} customers={customers} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

function Kanban({
  interventi,
  canEdit,
  busy,
  onStatus,
}: {
  interventi: InterventoRow[];
  canEdit: boolean;
  busy: string | null;
  onStatus: (id: string, s: InterventoStatus) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<InterventoStatus | null>(null);

  function drop(stage: InterventoStatus) {
    if (dragId) {
      const cur = interventi.find((i) => i.id === dragId);
      if (cur && cur.status !== stage) onStatus(dragId, stage);
    }
    setDragId(null);
    setOverStage(null);
  }

  return (
    <div className="kanban">
      {INTERVENTO_STATUS_ORDER.map((stage) => {
        const meta = INTERVENTO_STATUS_META[stage];
        const items = interventi.filter((i) => i.status === stage);
        return (
          <div
            className={"kanban-col" + (overStage === stage ? " drag-over" : "")}
            key={stage}
            onDragOver={
              canEdit
                ? (e) => {
                    e.preventDefault();
                    if (overStage !== stage) setOverStage(stage);
                  }
                : undefined
            }
            onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
            onDrop={canEdit ? () => drop(stage) : undefined}
          >
            <div className="kanban-col-head">
              <span className="badge-dot" style={{ background: meta.color }} />
              <span className="kanban-col-name">{meta.label}</span>
              <span className="kanban-col-count mono">{items.length}</span>
            </div>
            <div className="kanban-list">
              {items.map((i) => (
                <Ticket
                  key={i.id}
                  i={i}
                  canEdit={canEdit}
                  busy={busy === i.id}
                  onStatus={onStatus}
                  draggable={canEdit}
                  dragging={dragId === i.id}
                  onDragStart={() => setDragId(i.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStage(null);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Ticket({
  i,
  canEdit,
  busy,
  onStatus,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  i: InterventoRow;
  canEdit: boolean;
  busy: boolean;
  onStatus: (id: string, s: InterventoStatus) => void;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
  return (
    <div
      className={"ticket" + (busy ? " busy" : "") + (dragging ? " dragging" : "") + (draggable ? " draggable" : "")}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="ticket-top">
        <Link href={`/service/interventi/${i.id}`} className="ticket-id mono" draggable={false}>
          {i.code}
        </Link>
        <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>
          {prio.label}
        </span>
      </div>
      <Link href={`/service/interventi/${i.id}`} className="ticket-title" draggable={false}>
        {i.title}
      </Link>
      <div className="ticket-meta">
        {(i.machineJob || i.machineCode) && (
          <span className="ticket-meta-row">
            <Icon name="machines" size={13} /> <span className="mono">{i.machineJob || i.machineCode}</span>
          </span>
        )}
        {i.customer && (
          <span className="ticket-meta-row">
            <Icon name="people" size={13} /> {i.customer}
          </span>
        )}
        {i.site && (
          <span className="ticket-meta-row">
            <Icon name="pin" size={13} /> {i.site}
          </span>
        )}
      </div>
      <div className="ticket-foot">
        {i.tech ? (
          <span className="tech-avatar" title={i.tech}>
            {initials(i.tech)}
          </span>
        ) : (
          <span className="prio-chip" style={{ background: "#f59e0b1f", color: "#b45309" }}>
            Da assegnare
          </span>
        )}
        {canEdit && (
          <select
            className="ticket-status-select"
            value={i.status}
            disabled={busy}
            onChange={(e) => onStatus(i.id, e.target.value as InterventoStatus)}
          >
            {INTERVENTO_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {INTERVENTO_STATUS_META[s].label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function Lista({ interventi }: { interventi: InterventoRow[] }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Codice</th>
            <th>Titolo</th>
            <th>Cliente · Cantiere</th>
            <th>Macchina</th>
            <th>Stato</th>
            <th>Priorità</th>
            <th>Tecnico</th>
          </tr>
        </thead>
        <tbody>
          {interventi.map((i) => {
            const meta = INTERVENTO_STATUS_META[i.status];
            const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
            return (
              <tr key={i.id}>
                <td className="mono muted">
                  <Link href={`/service/interventi/${i.id}`} className="link-strong">
                    {i.code}
                  </Link>
                </td>
                <td style={{ fontWeight: 600 }}>
                  <Link href={`/service/interventi/${i.id}`} style={{ color: "inherit" }}>
                    {i.title}
                  </Link>
                </td>
                <td>
                  <div>{i.customer ?? "—"}</div>
                  <div className="muted small">{i.site ?? ""}</div>
                </td>
                <td className="mono">{i.machineJob || i.machineCode || "—"}</td>
                <td>
                  <span
                    className="status-chip"
                    style={{ background: meta.color + "22", color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </td>
                <td>
                  <span
                    className="prio-chip"
                    style={{ background: prio.color + "1f", color: prio.color }}
                  >
                    {prio.short}
                  </span>
                </td>
                <td>{i.tech ?? <span className="muted">Da assegnare</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewInterventoModal({
  techs,
  customers,
  onClose,
}: {
  techs: Tech[];
  customers: CustomerOpt[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [customerId, setCustomerId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [assignedTechId, setAssignedTechId] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customer = customers.find((c) => c.id === customerId) ?? null;

  function onCustomer(id: string) {
    setCustomerId(id);
    setMachineId("");
    setSiteId("");
  }

  async function save() {
    if (!title.trim()) {
      setErr("Inserisci un titolo.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/interventi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          priority,
          customerId: customerId || undefined,
          machineId: machineId || undefined,
          siteId: siteId || undefined,
          assignedTechId: assignedTechId || undefined,
          reportedBy: reportedBy || undefined,
          status: assignedTechId ? "PIANIFICATO" : "NUOVO",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel salvataggio.");
        return;
      }
      const d = await res.json();
      onClose();
      router.push(`/service/interventi/${d.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nuovo intervento</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Titolo *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Es. Sostituzione martelli mulino M3"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">Cliente</span>
            <select value={customerId} onChange={(e) => onCustomer(e.target.value)}>
              <option value="">— Seleziona cliente —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              Macchina {customer ? `(${customer.machines.length})` : ""}
            </span>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              disabled={!customer}
            >
              <option value="">
                {!customer
                  ? "Scegli prima il cliente"
                  : customer.machines.length
                  ? "— Seleziona macchina —"
                  : "Nessuna macchina per questo cliente"}
              </option>
              {customer?.machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.job || m.code} · {m.model}
                </option>
              ))}
            </select>
          </label>

          {customer && customer.sites.length > 0 && (
            <label className="field">
              <span className="field-label">Cantiere</span>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">— Nessuno —</option>
                {customer.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="sig-row">
            <label className="field">
              <span className="field-label">Priorità</span>
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                {[1, 2, 3].map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Tecnico</span>
              <select value={assignedTechId} onChange={(e) => setAssignedTechId(e.target.value)}>
                <option value="">— Da assegnare —</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.zona ? ` · ${t.zona}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field-label">Segnalato da</span>
            <input
              value={reportedBy}
              onChange={(e) => setReportedBy(e.target.value)}
              placeholder="Nome contatto cliente"
            />
          </label>
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Salvataggio…" : "Crea intervento"}
          </button>
        </div>
      </div>
    </div>
  );
}
