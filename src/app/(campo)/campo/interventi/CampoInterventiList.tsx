"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import ModalPortal from "@/components/ModalPortal";
import {
  INTERVENTO_STATUS_META,
  INTERVENTO_TYPE_META,
  INTERVENTO_TYPE_ORDER,
  DEFAULT_INTERVENTO_TYPE,
  PRIORITY_META,
  interventoTypeMeta,
} from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

export type CampoCustomer = {
  id: string;
  name: string;
  sites: { id: string; name: string }[];
  machines: { id: string; label: string }[];
};

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
  {
    key: "aperti",
    label: "Da fare",
    test: (s) => s === "DOCUMENTAZIONE" || s === "NUOVO" || s === "PIANIFICATO" || s === "IN_CORSO",
  },
  { key: "chiusi", label: "Chiusi", test: (s) => s === "COMPLETATO" || s === "FATTURATO" },
  { key: "tutti", label: "Tutti", test: () => true },
];

export default function CampoInterventiList({
  items,
  own,
  canCreate = false,
  customers = [],
}: {
  items: CampoItem[];
  own: boolean;
  canCreate?: boolean;
  customers?: CampoCustomer[];
}) {
  const [g, setG] = useState("aperti");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);

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
        <div className="campo-head-row">
          <div>
            <h1>Interventi</h1>
            <p>{own ? "I tuoi interventi assegnati" : `${items.length} interventi`}</p>
          </div>
          {canCreate && (
            <button className="btn-primary" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={16} /> Nuovo
            </button>
          )}
        </div>
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

      {showNew && (
        <CampoNewIntervento customers={customers} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

/** Creazione rapida da campo: solo i campi indispensabili, il resto si completa
 *  nel dettaglio dell'intervento. */
function CampoNewIntervento({
  customers,
  onClose,
}: {
  customers: CampoCustomer[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>(DEFAULT_INTERVENTO_TYPE);
  const [priority, setPriority] = useState(3);
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customer = customers.find((c) => c.id === customerId) ?? null;

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
          type,
          priority,
          customerId: customerId || undefined,
          siteId: siteId || undefined,
          machineId: machineId || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel salvataggio.");
        return;
      }
      const d = await res.json();
      onClose();
      router.push(`/campo/interventi/${d.id}`);
    } catch {
      setErr("Errore di rete.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nuovo intervento</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          {err && <div className="form-error">{err}</div>}
          <div className="form-row">
            <label>Titolo</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Es. Sostituzione coltelli trituratore"
            />
          </div>
          <div className="form-row">
            <label>Tipo</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {INTERVENTO_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {INTERVENTO_TYPE_META[t]?.label ?? t}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Priorità</label>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            >
              <option value={1}>P1 — Critico</option>
              <option value={2}>P2 — Alto</option>
              <option value={3}>P3 — Normale</option>
            </select>
          </div>
          <div className="form-row">
            <label>Cliente</label>
            <select
              className="input"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setSiteId("");
                setMachineId("");
              }}
            >
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {customer && customer.sites.length > 0 && (
            <div className="form-row">
              <label>Cantiere</label>
              <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">—</option>
                {customer.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {customer && customer.machines.length > 0 && (
            <div className="form-row">
              <label>Macchina</label>
              <select
                className="input"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
              >
                <option value="">—</option>
                {customer.machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Creazione…" : "Crea intervento"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
