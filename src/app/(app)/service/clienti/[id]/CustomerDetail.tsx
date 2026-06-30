"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { Flag } from "@/components/Icon";
import {
  COUNTRIES,
  INTERVENTO_STATUS_META,
  PRIORITY_META,
  STATUS_META,
} from "@/lib/domain";
import type { InterventoStatus, MachineStatus } from "@prisma/client";

type SiteRow = {
  id: string;
  name: string;
  city: string | null;
  province: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
};
type Data = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  province: string | null;
  country: string;
  countryCode: string;
  contractType: string | null;
  phone: string | null;
  email: string | null;
  erpConto: number | null;
  sites: SiteRow[];
  machines: { id: string; code: string; job: string; model: string; status: MachineStatus }[];
  interventi: { id: string; code: string; title: string; status: InterventoStatus; priority: number }[];
};
type ErpHit = { conto: number; name: string; countryName: string | null; city: string | null };

export default function CustomerDetail({
  data,
  canManage,
  erpAvailable,
}: {
  data: Data;
  canManage: boolean;
  erpAvailable: boolean;
}) {
  const router = useRouter();
  const ro = !canManage;

  // anagrafica
  const [f, setF] = useState({
    name: data.name,
    city: data.city ?? "",
    province: data.province ?? "",
    country: data.country,
    contractType: data.contractType ?? "Standard",
    phone: data.phone ?? "",
    email: data.email ?? "",
  });
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [savingAna, setSavingAna] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function saveAna() {
    setSavingAna(true);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/clienti/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      setSavedMsg(res.ok ? "Salvato." : "Errore.");
      router.refresh();
    } finally {
      setSavingAna(false);
    }
  }

  // ERP link
  const [erpQ, setErpQ] = useState(data.name);
  const [erpHits, setErpHits] = useState<ErpHit[] | null>(null);
  const [erpBusy, setErpBusy] = useState(false);
  const [erpErr, setErpErr] = useState<string | null>(null);
  async function searchErp() {
    setErpBusy(true);
    setErpErr(null);
    try {
      const res = await fetch(`/api/erp/customers?q=${encodeURIComponent(erpQ)}`);
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setErpErr(d?.error ?? "Errore gestionale.");
        setErpHits([]);
        return;
      }
      setErpHits(d.customers ?? []);
    } finally {
      setErpBusy(false);
    }
  }
  async function linkErp(conto: number | null) {
    await fetch(`/api/clienti/${data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ erpConto: conto }),
    });
    setErpHits(null);
    router.refresh();
  }
  const [erpSyncMsg, setErpSyncMsg] = useState<string | null>(null);
  const [erpSyncing, setErpSyncing] = useState(false);
  async function syncFromErp() {
    setErpSyncing(true);
    setErpSyncMsg(null);
    try {
      const res = await fetch(`/api/clienti/${data.id}/erp-sync`, { method: "POST" });
      const d = await res.json().catch(() => null);
      setErpSyncMsg(
        res.ok
          ? `Aggiornato: ${[d.customer?.city, d.customer?.province, d.customer?.country].filter(Boolean).join(", ")}`
          : d?.error ?? "Errore."
      );
      if (res.ok) router.refresh();
    } finally {
      setErpSyncing(false);
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <Link href="/service/clienti" className="back-link">
            <Icon name="arrow-left" size={14} /> Clienti
          </Link>
          <h1>
            <span className="mono muted" style={{ fontSize: 15, marginRight: 10 }}>
              {data.code}
            </span>
            {data.name}
          </h1>
          <div className="chip-row">
            <span className="flex-inline">
              <Flag code={data.countryCode} /> {data.country}
            </span>
            {data.erpConto && (
              <span className="status-chip" style={{ background: "#10b98122", color: "#0a7d52" }}>
                ERP #{data.erpConto}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid-two">
        {/* Anagrafica */}
        <section className="card">
          <div className="card-header">
            <h3>Anagrafica</h3>
            {savedMsg && <span className="muted small">{savedMsg}</span>}
          </div>
          <div className="field">
            <span className="field-label">Ragione sociale</span>
            <input value={f.name} disabled={ro} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="sig-row">
            <div className="field">
              <span className="field-label">Città</span>
              <input value={f.city} disabled={ro} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="field">
              <span className="field-label">Provincia</span>
              <input value={f.province} disabled={ro} onChange={(e) => set("province", e.target.value)} />
            </div>
          </div>
          <div className="sig-row">
            <div className="field">
              <span className="field-label">Paese</span>
              <select value={f.country} disabled={ro} onChange={(e) => set("country", e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.label}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field-label">Contratto</span>
              <select value={f.contractType} disabled={ro} onChange={(e) => set("contractType", e.target.value)}>
                <option>Standard</option>
                <option>Premium</option>
              </select>
            </div>
          </div>
          <div className="sig-row">
            <div className="field">
              <span className="field-label">Telefono</span>
              <input value={f.phone} disabled={ro} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="field">
              <span className="field-label">Email</span>
              <input value={f.email} disabled={ro} onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>
          {canManage && (
            <div className="rapportino-actions">
              <button className="btn-primary" onClick={saveAna} disabled={savingAna}>
                {savingAna ? "Salvataggio…" : "Salva anagrafica"}
              </button>
            </div>
          )}

          {/* ERP link */}
          {canManage && (
            <div className="erp-link-box">
              <div className="field-label">Aggancio gestionale (ERP)</div>
              {!erpAvailable ? (
                <div className="muted small">Gestionale non configurato.</div>
              ) : (
                <>
                  <div className="flex-inline" style={{ gap: 8 }}>
                    <input
                      value={erpQ}
                      onChange={(e) => setErpQ(e.target.value)}
                      placeholder="Cerca cliente nel gestionale…"
                      style={{ flex: 1 }}
                    />
                    <button className="btn-ghost-sm" onClick={searchErp} disabled={erpBusy}>
                      {erpBusy ? "…" : "Cerca"}
                    </button>
                    {data.erpConto && (
                      <button className="btn-ghost-sm" onClick={() => linkErp(null)}>
                        Scollega
                      </button>
                    )}
                  </div>
                  {data.erpConto && (
                    <div className="flex-inline" style={{ gap: 8, marginTop: 6 }}>
                      <button className="btn-ghost-sm" onClick={syncFromErp} disabled={erpSyncing}>
                        <Icon name="download" size={13} /> {erpSyncing ? "Sincronizzo…" : "Sincronizza posizione da gestionale"}
                      </button>
                      {erpSyncMsg && <span className="muted small">{erpSyncMsg}</span>}
                    </div>
                  )}
                  {erpErr && <div className="muted small" style={{ marginTop: 6 }}>{erpErr}</div>}
                  {erpHits && (
                    <div className="erp-hits">
                      {erpHits.length === 0 && <div className="muted small">Nessun risultato.</div>}
                      {erpHits.map((h) => (
                        <button key={h.conto} className="erp-hit" onClick={() => linkErp(h.conto)}>
                          <span style={{ fontWeight: 600 }}>{h.name}</span>
                          <span className="muted small">
                            #{h.conto}
                            {h.city ? ` · ${h.city}` : ""}
                            {h.countryName ? ` · ${h.countryName}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Cantieri */}
        <SitesCard customerId={data.id} sites={data.sites} canManage={canManage} />
      </div>

      <div className="grid-two">
        {/* Interventi */}
        <section className="card">
          <div className="card-header">
            <h3>Interventi recenti</h3>
            <span className="muted small">{data.interventi.length}</span>
          </div>
          <ul className="mini-list">
            {data.interventi.map((i) => {
              const meta = INTERVENTO_STATUS_META[i.status];
              const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
              return (
                <li key={i.id}>
                  <Link href={`/service/interventi/${i.id}`} className="mini-row">
                    <span className="mono muted small">{i.code}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{i.title}</span>
                    <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>
                      {prio.short}
                    </span>
                    <span className="status-chip" style={{ background: meta.color + "22", color: meta.color }}>
                      {meta.label}
                    </span>
                  </Link>
                </li>
              );
            })}
            {data.interventi.length === 0 && <li className="muted small">Nessun intervento.</li>}
          </ul>
        </section>

        {/* Macchine collegate */}
        <section className="card">
          <div className="card-header">
            <h3>Macchine (fascicoli)</h3>
            <span className="muted small">{data.machines.length}</span>
          </div>
          <ul className="mini-list">
            {data.machines.map((m) => {
              const meta = STATUS_META[m.status];
              return (
                <li key={m.id}>
                  <Link href={`/macchine/${m.code}`} className="mini-row">
                    <span className="mono">{m.job || m.code}</span>
                    <span style={{ flex: 1 }} className="muted small">
                      {m.model}
                    </span>
                    <span className="status-chip" style={{ background: meta.color + "22", color: meta.color }}>
                      {meta.label}
                    </span>
                  </Link>
                </li>
              );
            })}
            {data.machines.length === 0 && (
              <li className="muted small">Nessuna macchina collegata a questo cliente.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SitesCard({
  customerId,
  sites,
  canManage,
}: {
  customerId: string;
  sites: SiteRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = { name: "", city: "", province: "", lat: "", lng: "" };
  const [n, setN] = useState(blank);

  async function addSite() {
    if (!n.name.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, ...n }),
      });
      setN(blank);
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function delSite(id: string) {
    if (!confirm("Eliminare il cantiere?")) return;
    await fetch(`/api/sites/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="card">
      <div className="card-header">
        <h3>Cantieri / Stabilimenti</h3>
        {canManage && !adding && (
          <button className="btn-ghost-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> Aggiungi
          </button>
        )}
      </div>

      <ul className="mini-list">
        {sites.map((s) => (
          <li key={s.id} className="site-row">
            <span className={"badge-dot"} style={{ background: s.status === "alert" ? "#dc2626" : s.status === "in_corso" ? "#2f6aed" : "#10b981" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div className="muted small">
                {[s.city, s.province].filter(Boolean).join(" ")}
                {s.lat != null && s.lng != null ? ` · ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : " · no geo"}
              </div>
            </div>
            {canManage && (
              <button className="icon-btn sm" onClick={() => delSite(s.id)} aria-label="Elimina">
                <Icon name="trash" size={14} />
              </button>
            )}
          </li>
        ))}
        {sites.length === 0 && !adding && <li className="muted small">Nessun cantiere.</li>}
      </ul>

      {adding && (
        <div className="site-add">
          <div className="field">
            <span className="field-label">Nome cantiere *</span>
            <input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} autoFocus />
          </div>
          <div className="sig-row">
            <div className="field">
              <span className="field-label">Città</span>
              <input value={n.city} onChange={(e) => setN({ ...n, city: e.target.value })} />
            </div>
            <div className="field">
              <span className="field-label">Prov.</span>
              <input value={n.province} onChange={(e) => setN({ ...n, province: e.target.value })} />
            </div>
          </div>
          <div className="sig-row">
            <div className="field">
              <span className="field-label">Lat</span>
              <input value={n.lat} onChange={(e) => setN({ ...n, lat: e.target.value })} placeholder="45.5416" />
            </div>
            <div className="field">
              <span className="field-label">Lng</span>
              <input value={n.lng} onChange={(e) => setN({ ...n, lng: e.target.value })} placeholder="10.2118" />
            </div>
          </div>
          <div className="rapportino-actions">
            <button className="btn-ghost" onClick={() => setAdding(false)} disabled={busy}>
              Annulla
            </button>
            <button className="btn-primary" onClick={addSite} disabled={busy}>
              {busy ? "…" : "Aggiungi cantiere"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
