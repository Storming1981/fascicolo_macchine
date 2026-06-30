"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { ROLE_LABEL } from "@/lib/domain";
import {
  PERM_ACTIONS,
  ALL_ROLES,
  type PermissionMatrix,
  type PermAction,
} from "@/lib/permissions";

type PlantConfig = { name: string; models: string[] }[];

type SyncSummary = {
  total: number;
  matched: number;
  updated: number;
  withProduction: number;
  errors: { code: string; error: string }[];
};

export default function SettingsClient({
  plantConfig,
  permissions,
  canSync,
  erpConfigured,
}: {
  plantConfig: PlantConfig;
  permissions: PermissionMatrix;
  canSync: boolean;
  erpConfigured: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"plant" | "perms" | "erp">("plant");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [plants, setPlants] = useState<{ name: string; models: string }[]>(
    plantConfig.map((p) => ({ name: p.name, models: p.models.join("\n") }))
  );
  const [perms, setPerms] = useState<PermissionMatrix>(
    JSON.parse(JSON.stringify(permissions))
  );
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState(false);

  const notify = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  };

  function setPlantName(i: number, name: string) {
    setPlants((s) => s.map((p, idx) => (idx === i ? { ...p, name } : p)));
  }
  function setPlantModels(i: number, models: string) {
    setPlants((s) => s.map((p, idx) => (idx === i ? { ...p, models } : p)));
  }
  function addPlant() {
    setPlants((s) => [...s, { name: "NUOVA TIPOLOGIA", models: "" }]);
  }
  function removePlant(i: number) {
    setPlants((s) => s.filter((_, idx) => idx !== i));
  }

  async function savePlants() {
    setBusy(true);
    const cfg = plants
      .map((p) => ({
        name: p.name.trim(),
        models: p.models
          .split("\n")
          .map((m) => m.trim())
          .filter(Boolean),
      }))
      .filter((p) => p.name);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantConfig: cfg }),
    });
    setBusy(false);
    if (res.ok) {
      notify("Tipologie e modelli salvati");
      router.refresh();
    } else notify("Errore salvataggio", "err");
  }

  function toggle(role: string, action: PermAction) {
    setPerms((s) => ({
      ...s,
      [role]: { ...s[role], [action]: !s[role]?.[action] },
    }));
  }

  async function savePerms() {
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: perms }),
    });
    setBusy(false);
    if (res.ok) {
      notify("Permessi salvati");
      router.refresh();
    } else notify("Errore salvataggio", "err");
  }

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/erp/sync-all", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setSyncResult(d as SyncSummary);
        notify(`Sincronizzati ${d.updated}/${d.total} fascicoli dal gestionale`);
        router.refresh();
      } else {
        notify(d.error || "Errore sincronizzazione", "err");
      }
    } catch {
      notify("Gestionale non raggiungibile", "err");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Impostazioni</h1>
          <p>Gestione tipologie impianto / modelli e permessi per ruolo utente</p>
        </div>
      </div>

      <div className="tabs">
        <button
          className={"tab" + (tab === "plant" ? " active" : "")}
          onClick={() => setTab("plant")}
        >
          <Icon name="gear" size={14} /> <span>Tipologie &amp; Modelli</span>
        </button>
        <button
          className={"tab" + (tab === "perms" ? " active" : "")}
          onClick={() => setTab("perms")}
        >
          <Icon name="people" size={14} /> <span>Permessi per ruolo</span>
        </button>
        {canSync && (
          <button
            className={"tab" + (tab === "erp" ? " active" : "")}
            onClick={() => setTab("erp")}
          >
            <Icon name="clock" size={14} /> <span>Gestionale (ERP)</span>
          </button>
        )}
      </div>

      {tab === "plant" && (
        <div className="tab-content">
          <div className="cmp-toolbar">
            <div className="cmp-summary">
              <span className="muted">Tipologie configurate:</span>{" "}
              <strong>{plants.length}</strong>
            </div>
            <div className="cmp-actions">
              <button className="btn-ghost-sm" onClick={addPlant}>
                <Icon name="plus" size={14} /> Aggiungi tipologia
              </button>
              <button className="btn-primary-sm" disabled={busy} onClick={savePlants}>
                <Icon name="check" size={14} /> Salva
              </button>
            </div>
          </div>
          <div className="cmp-list">
            {plants.map((p, i) => (
              <div className="card" key={i} style={{ marginBottom: 8 }}>
                <div className="form-grid" style={{ gridTemplateColumns: "1fr 1.4fr auto", alignItems: "start" }}>
                  <div className="form-row">
                    <label>Tipologia impianto</label>
                    <input
                      className="input"
                      value={p.name}
                      onChange={(e) => setPlantName(i, e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label>Modelli (uno per riga)</label>
                    <textarea
                      className="input"
                      rows={4}
                      value={p.models}
                      onChange={(e) => setPlantModels(i, e.target.value)}
                      placeholder={"CONTAINER ELETTRICO\nCORPO TRITURATORE"}
                    />
                  </div>
                  <div className="form-row">
                    <label>&nbsp;</label>
                    <button className="btn-danger" onClick={() => removePlant(i)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Le tipologie e i modelli qui definiti popolano il menu della creazione
            fascicolo. &quot;Altro / Personalizzato&quot; è sempre disponibile.
          </p>
        </div>
      )}

      {tab === "perms" && (
        <div className="tab-content">
          <div className="cmp-toolbar">
            <div className="cmp-summary muted">
              L&apos;amministratore ha sempre tutti i permessi e non è modificabile.
            </div>
            <div className="cmp-actions">
              <button className="btn-primary-sm" disabled={busy} onClick={savePerms}>
                <Icon name="check" size={14} /> Salva permessi
              </button>
            </div>
          </div>
          <div className="card no-pad">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ruolo</th>
                    {PERM_ACTIONS.map((a) => (
                      <th key={a.key} style={{ textAlign: "center" }}>
                        {a.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_ROLES.map((role) => {
                    const isAdmin = role === "ADMIN";
                    return (
                      <tr key={role}>
                        <td style={{ fontWeight: 500 }}>{ROLE_LABEL[role]}</td>
                        {PERM_ACTIONS.map((a) => {
                          const on = isAdmin ? true : !!perms[role]?.[a.key];
                          return (
                            <td key={a.key} style={{ textAlign: "center" }}>
                              <button
                                className={"check-box" + (on ? " on" : "")}
                                style={{ margin: "0 auto" }}
                                disabled={isAdmin}
                                onClick={() => toggle(role, a.key)}
                                aria-label={a.label}
                              >
                                {on && <Icon name="check" size={12} />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "erp" && canSync && (
        <div className="tab-content">
          <div className="card">
            <div className="card-header">
              <h3>Sincronizzazione dal gestionale ZATO</h3>
              <button
                className="btn-primary-sm"
                disabled={syncing || !erpConfigured}
                onClick={runSync}
              >
                <Icon name="clock" size={14} />{" "}
                {syncing ? "Sincronizzazione…" : "Sincronizza tutti i fascicoli"}
              </button>
            </div>
            {!erpConfigured ? (
              <p className="muted small">
                Integrazione gestionale non configurata (variabili{" "}
                <span className="mono">SQLSERVER_*</span> mancanti).
              </p>
            ) : (
              <>
                <p className="muted small">
                  Legge il gestionale (SQL Server) e aggiorna ogni fascicolo i cui job
                  corrispondono a una commessa: <strong>cliente e paese</strong>,{" "}
                  <strong>descrizione commessa</strong>, <strong>ore di lavorazione</strong> e{" "}
                  <strong>inizio/fine produzione</strong> (prima/ultima timbratura, tabella{" "}
                  <span className="mono">avlavp</span>). Le date di produzione vengono salvate
                  nel diario con origine <span className="mono">GESTIONALE</span>. I campi
                  assenti nel gestionale non vengono toccati.
                </p>
                {syncing && (
                  <p className="muted small">
                    Operazione in corso su tutti i fascicoli, può richiedere qualche
                    minuto…
                  </p>
                )}
                {syncResult && (
                  <div className="card no-pad" style={{ marginTop: 12 }}>
                    <div className="table-wrap">
                      <table className="data-table">
                        <tbody>
                          <tr>
                            <td>Fascicoli totali</td>
                            <td style={{ fontWeight: 600 }}>{syncResult.total}</td>
                          </tr>
                          <tr>
                            <td>Trovati nel gestionale</td>
                            <td style={{ fontWeight: 600 }}>{syncResult.matched}</td>
                          </tr>
                          <tr>
                            <td>Aggiornati</td>
                            <td style={{ fontWeight: 600 }}>{syncResult.updated}</td>
                          </tr>
                          <tr>
                            <td>Con dati di produzione</td>
                            <td style={{ fontWeight: 600 }}>{syncResult.withProduction}</td>
                          </tr>
                          {syncResult.errors.length > 0 && (
                            <tr>
                              <td style={{ color: "var(--danger, #b3261e)" }}>Errori</td>
                              <td>{syncResult.errors.length}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <p className="muted small" style={{ marginTop: 10 }}>
                  In sviluppo è disponibile anche da terminale:{" "}
                  <span className="mono">npm run erp:sync</span>. In produzione questa
                  operazione potrà essere schedulata.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-wrap">
          <div className={"toast " + toast.kind}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
