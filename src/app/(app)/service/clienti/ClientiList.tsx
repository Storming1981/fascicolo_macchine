"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { Flag } from "@/components/Icon";
import { COUNTRIES } from "@/lib/domain";

export type CustomerRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  province: string | null;
  countryCode: string;
  contractType: string | null;
  phone: string | null;
  erpConto: number | null;
  sites: number;
  interventi: number;
  machines: number;
};

export default function ClientiList({
  clienti,
  canManage,
}: {
  clienti: CustomerRow[];
  canManage: boolean;
}) {
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const filtered = clienti.filter(
    (c) =>
      !q.trim() ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.code.toLowerCase().includes(q.toLowerCase()) ||
      (c.city ?? "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Clienti &amp; Cantieri</h1>
          <p>{clienti.length} aziende · anagrafica condivisa con i fascicoli</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} /> Nuovo cliente
          </button>
        )}
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="table-toolbar">
          <div className="search" style={{ maxWidth: 320 }}>
            <Icon name="search" size={15} color="var(--muted)" />
            <input
              placeholder="Cerca nome, codice, città…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Codice</th>
              <th>Cliente</th>
              <th>Sede</th>
              <th>Contratto</th>
              <th>Cantieri</th>
              <th>Interventi</th>
              <th>Macchine</th>
              <th>ERP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className="mono muted">
                  <Link href={`/service/clienti/${c.id}`} className="link-strong">
                    {c.code}
                  </Link>
                </td>
                <td style={{ fontWeight: 600 }}>
                  <Link href={`/service/clienti/${c.id}`} style={{ color: "inherit" }}>
                    {c.name}
                  </Link>
                </td>
                <td>
                  <span className="flex-inline">
                    <Flag code={c.countryCode} />
                    {c.city ?? "—"}
                    {c.province ? ` (${c.province})` : ""}
                  </span>
                </td>
                <td>
                  {c.contractType ? (
                    <span
                      className="prio-chip"
                      style={
                        c.contractType === "Premium"
                          ? { background: "#f59e0b1f", color: "#b45309" }
                          : { background: "#eef3fd", color: "#2f6aed" }
                      }
                    >
                      {c.contractType}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="mono">{c.sites}</td>
                <td className="mono">{c.interventi}</td>
                <td className="mono">{c.machines}</td>
                <td>
                  {c.erpConto ? (
                    <span className="status-chip" style={{ background: "#10b98122", color: "#0a7d52" }}>
                      #{c.erpConto}
                    </span>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-state">
                  Nessun cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && <NewCustomerModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewCustomerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: "",
    city: "",
    province: "",
    country: "Italia",
    contractType: "Standard",
    phone: "",
    email: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.name.trim()) {
      setErr("Inserisci il nome.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/clienti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel salvataggio.");
        return;
      }
      const d = await res.json();
      onClose();
      router.push(`/service/clienti/${d.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nuovo cliente</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Ragione sociale *</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </label>
          <div className="sig-row">
            <label className="field">
              <span className="field-label">Città</span>
              <input value={f.city} onChange={(e) => set("city", e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Provincia</span>
              <input value={f.province} onChange={(e) => set("province", e.target.value)} placeholder="BS" />
            </label>
          </div>
          <div className="sig-row">
            <label className="field">
              <span className="field-label">Paese</span>
              <select value={f.country} onChange={(e) => set("country", e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.label}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Contratto</span>
              <select value={f.contractType} onChange={(e) => set("contractType", e.target.value)}>
                <option>Standard</option>
                <option>Premium</option>
              </select>
            </label>
          </div>
          <div className="sig-row">
            <label className="field">
              <span className="field-label">Telefono</span>
              <input value={f.phone} onChange={(e) => set("phone", e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input value={f.email} onChange={(e) => set("email", e.target.value)} />
            </label>
          </div>
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Salvataggio…" : "Crea cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}
