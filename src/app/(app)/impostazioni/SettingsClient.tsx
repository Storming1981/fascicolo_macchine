"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { ROLE_LABEL } from "@/lib/domain";
import {
  PERM_ACTIONS,
  ALL_ROLES,
  type PermissionMatrix,
  type PermAction,
} from "@/lib/permissions";
import { NAV_ITEMS, type NavVisibility, type NavKey } from "@/lib/nav";
import type { AppAccessMatrix, AppProfile } from "@/lib/appAccess";

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
  navVisibility,
  appAccess,
  canSync,
  erpConfigured,
  googleConfigured,
  googleMe,
  googleCompany,
  currentUserEmail,
}: {
  plantConfig: PlantConfig;
  permissions: PermissionMatrix;
  navVisibility: NavVisibility;
  appAccess: AppAccessMatrix;
  canSync: boolean;
  erpConfigured: boolean;
  googleConfigured: boolean;
  googleMe: { email: string; connectedAt: string } | null;
  googleCompany: { email: string; connectedAt: string; connectedByName: string | null } | null;
  currentUserEmail: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"plant" | "perms" | "nav" | "erp" | "google">("plant");
  const [gBusy, setGBusy] = useState<"test" | "unlink-me" | "unlink-company" | null>(null);
  const [testTo, setTestTo] = useState(currentUserEmail);
  const [navm, setNavm] = useState<NavVisibility>(JSON.parse(JSON.stringify(navVisibility)));
  const [appm, setAppm] = useState<AppAccessMatrix>(JSON.parse(JSON.stringify(appAccess)));
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

  // Esito del ritorno dal consenso Google (/impostazioni?google=ok|err)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const g = sp.get("google");
    if (!g) return;
    setTab("google");
    if (g === "ok") notify(`Account Google collegato: ${sp.get("email") ?? ""}`);
    else notify(sp.get("msg") || "Collegamento Google non riuscito", "err");
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function googleTest() {
    setGBusy("test");
    try {
      const res = await fetch("/api/google/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) notify(`Mail di prova inviata a ${d?.to ?? testTo} (da ${d?.from ?? "?"})`);
      else notify(d?.error ?? "Invio di prova fallito", "err");
    } finally {
      setGBusy(null);
    }
  }

  async function googleUnlink(target: "me" | "company") {
    const msg =
      target === "me"
        ? "Scollegare la tua casella Gmail? Tornerai a inviare dalla casella aziendale (se disponibile)."
        : "Scollegare la casella aziendale? Chi non ha collegato la propria non potrà più inviare.";
    if (!confirm(msg)) return;
    setGBusy(target === "me" ? "unlink-me" : "unlink-company");
    try {
      const res = await fetch(`/api/google/account?target=${target}`, { method: "DELETE" });
      if (res.ok) {
        notify("Casella scollegata");
        router.refresh();
      } else notify("Errore nello scollegamento", "err");
    } finally {
      setGBusy(null);
    }
  }

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

  function toggleNav(role: string, key: NavKey) {
    setNavm((s) => ({ ...s, [role]: { ...s[role], [key]: !s[role]?.[key] } }));
  }

  async function saveNav() {
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navVisibility: navm, appAccess: appm }),
    });
    setBusy(false);
    if (res.ok) {
      notify("Menu e accessi salvati");
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
        <button
          className={"tab" + (tab === "nav" ? " active" : "")}
          onClick={() => setTab("nav")}
        >
          <Icon name="menu" size={14} /> <span>Menu &amp; Navigazione</span>
        </button>
        {canSync && (
          <button
            className={"tab" + (tab === "erp" ? " active" : "")}
            onClick={() => setTab("erp")}
          >
            <Icon name="clock" size={14} /> <span>Gestionale (ERP)</span>
          </button>
        )}
        <button
          className={"tab" + (tab === "google" ? " active" : "")}
          onClick={() => setTab("google")}
        >
          <Icon name="upload" size={14} /> <span>Account Google</span>
        </button>
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
                <div className="form-grid form-grid-3">
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

      {tab === "nav" && (
        <div className="tab-content">
          <div className="cmp-toolbar">
            <div className="cmp-summary muted">
              Definisci l&apos;<strong>app di partenza</strong> per ruolo e quali
              <strong> menu</strong> vede ogni ruolo. L&apos;amministratore vede sempre tutto.
            </div>
            <div className="cmp-actions">
              <button className="btn-primary-sm" disabled={busy} onClick={saveNav}>
                <Icon name="check" size={14} /> Salva menu e accessi
              </button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-header">
              <h3>App di partenza per ruolo</h3>
            </div>
            <p className="muted small" style={{ marginTop: -4 }}>
              «Desktop completo» = applicazione con sidebar sul PC; su tablet/telefono passa
              automaticamente alla versione Campo. «Solo Campo» = sempre e solo l&apos;app
              mobile/tablet (operativi).
            </p>
            <div className="app-access-grid">
              {ALL_ROLES.map((role) => {
                const isAdmin = role === "ADMIN";
                const val: AppProfile = isAdmin ? "desktop" : appm[role] ?? "field";
                return (
                  <div key={role} className="app-access-row">
                    <span style={{ fontWeight: 500 }}>{ROLE_LABEL[role]}</span>
                    <select
                      value={val}
                      disabled={isAdmin}
                      onChange={(e) => setAppm((s) => ({ ...s, [role]: e.target.value as AppProfile }))}
                    >
                      <option value="desktop">Desktop completo</option>
                      <option value="field">Solo Campo</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card no-pad">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ruolo</th>
                    {NAV_ITEMS.map((n) => (
                      <th key={n.key} style={{ textAlign: "center" }}>
                        {n.label}
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
                        {NAV_ITEMS.map((n) => {
                          const onv = isAdmin ? true : !!navm[role]?.[n.key];
                          return (
                            <td key={n.key} style={{ textAlign: "center" }}>
                              <button
                                className={"check-box" + (onv ? " on" : "")}
                                style={{ margin: "0 auto" }}
                                disabled={isAdmin}
                                onClick={() => toggleNav(role, n.key)}
                                aria-label={n.label}
                              >
                                {onv && <Icon name="check" size={12} />}
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
          <p className="muted small" style={{ marginTop: 10 }}>
            Import Dati e Impostazioni restano legati ai permessi «Import massivo» e
            «Gestire impostazioni».
          </p>
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

      {tab === "google" && (
        <div className="tab-content">
          {!googleConfigured ? (
            <div className="card">
              <div className="card-header">
                <h3>Invio email non configurato</h3>
              </div>
              <p className="muted small">
                Integrazione Google non configurata: mancano le variabili{" "}
                <span className="mono">GOOGLE_CLIENT_ID</span>, <span className="mono">GOOGLE_CLIENT_SECRET</span> e{" "}
                <span className="mono">GOOGLE_REDIRECT_URI</span> nel file <span className="mono">.env</span>.
              </p>
              <p className="muted small" style={{ marginTop: 10 }}>
                Da creare in <strong>Google Cloud Console</strong>: abilita la <strong>Gmail API</strong>, imposta la
                schermata consenso su <strong>Internal</strong> (Workspace ZATO) con gli scope{" "}
                <span className="mono">gmail.send</span> e <span className="mono">userinfo.email</span>, quindi crea un{" "}
                <strong>ID client OAuth 2.0</strong> di tipo <em>Applicazione web</em> con URI di reindirizzamento{" "}
                <span className="mono">{"<dominio>"}/api/google/callback</span>.
              </p>
            </div>
          ) : (
            <>
              {/* La mia casella (personale) */}
              <div className="card">
                <div className="card-header">
                  <h3>La mia casella Gmail</h3>
                  {!googleMe && (
                    <a className="btn-primary-sm" href="/api/google/auth?target=me">
                      <Icon name="upload" size={14} /> Collega la tua Gmail
                    </a>
                  )}
                </div>
                {!googleMe ? (
                  <p className="muted small">
                    Collega il tuo account Google per inviare i rapportini <strong>dal tuo indirizzo</strong> (le
                    risposte dei clienti arriveranno a te). Se non lo colleghi, userai la casella aziendale.
                  </p>
                ) : (
                  <>
                    <div className="card no-pad" style={{ marginTop: 4 }}>
                      <div className="table-wrap">
                        <table className="data-table">
                          <tbody>
                            <tr>
                              <td>Indirizzo collegato</td>
                              <td style={{ fontWeight: 600 }}>{googleMe.email}</td>
                            </tr>
                            <tr>
                              <td>Data collegamento</td>
                              <td>{new Date(googleMe.connectedAt).toLocaleString("it-IT")}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="cmp-toolbar" style={{ marginTop: 12 }}>
                      <div className="cmp-summary" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="muted small">Invia una prova a:</span>
                        <input
                          value={testTo}
                          onChange={(e) => setTestTo(e.target.value)}
                          placeholder="indirizzo@esempio.it"
                          style={{ minWidth: 220 }}
                        />
                      </div>
                      <div className="cmp-actions">
                        <button className="btn-ghost-sm" onClick={googleTest} disabled={gBusy !== null}>
                          <Icon name="upload" size={13} /> {gBusy === "test" ? "Invio…" : "Invia prova"}
                        </button>
                        <a className="btn-ghost-sm" href="/api/google/auth?target=me">
                          <Icon name="clock" size={13} /> Ricollega
                        </a>
                        <button
                          className="btn-ghost-sm danger"
                          onClick={() => googleUnlink("me")}
                          disabled={gBusy !== null}
                        >
                          <Icon name="trash" size={13} /> {gBusy === "unlink-me" ? "Scollego…" : "Scollega"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Casella aziendale (fallback) — solo chi gestisce le impostazioni */}
              <div className="card" style={{ marginTop: 12 }}>
                <div className="card-header">
                  <h3>Casella aziendale (fallback)</h3>
                  {!googleCompany && (
                    <a className="btn-ghost-sm" href="/api/google/auth?target=company">
                      <Icon name="upload" size={14} /> Collega casella aziendale
                    </a>
                  )}
                </div>
                {!googleCompany ? (
                  <p className="muted small">
                    Account unico (es. <span className="mono">service@zato.it</span>) usato da chi non ha collegato la
                    propria casella. Collegalo una volta sola.
                  </p>
                ) : (
                  <>
                    <div className="card no-pad" style={{ marginTop: 4 }}>
                      <div className="table-wrap">
                        <table className="data-table">
                          <tbody>
                            <tr>
                              <td>Indirizzo aziendale</td>
                              <td style={{ fontWeight: 600 }}>{googleCompany.email}</td>
                            </tr>
                            <tr>
                              <td>Collegato da</td>
                              <td>{googleCompany.connectedByName ?? "—"}</td>
                            </tr>
                            <tr>
                              <td>Data collegamento</td>
                              <td>{new Date(googleCompany.connectedAt).toLocaleString("it-IT")}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="cmp-toolbar" style={{ marginTop: 12 }}>
                      <div className="cmp-summary" />
                      <div className="cmp-actions">
                        <a className="btn-ghost-sm" href="/api/google/auth?target=company">
                          <Icon name="clock" size={13} /> Ricollega
                        </a>
                        <button
                          className="btn-ghost-sm danger"
                          onClick={() => googleUnlink("company")}
                          disabled={gBusy !== null}
                        >
                          <Icon name="trash" size={13} /> {gBusy === "unlink-company" ? "Scollego…" : "Scollega"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <p className="muted small" style={{ marginTop: 10 }}>
                  I token sono salvati <strong>cifrati</strong> nel database e non lasciano mai il server. Il rinnovo
                  dell&apos;accesso è automatico: non serve rifare il login.
                </p>
              </div>
            </>
          )}
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
