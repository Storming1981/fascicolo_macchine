"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { initials } from "@/lib/domain";
import type { ExternalSignerRow } from "@/lib/externalSigners";

/**
 * Persone esterne senza account (cliente, ente certificatore, fornitore) che
 * possono firmare, ad esempio, l'approvazione del collaudo. Raggruppate per
 * ditta: è la chiave con cui si cercano ("chi viene da ACME?").
 */
export default function ExternalSigners({
  signers,
  canManage,
  q,
}: {
  signers: ExternalSignerRow[];
  canManage: boolean;
  q: string;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<ExternalSignerRow | "new" | null>(null);
  const [accountFor, setAccountFor] = useState<ExternalSignerRow | null>(null);
  const [company, setCompany] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const companies = Array.from(new Set(signers.map((s) => s.company))).sort((a, b) => a.localeCompare(b));
  const t = q.trim().toLowerCase();
  const filtered = signers.filter((s) => {
    if (!showInactive && !s.active) return false;
    if (company && s.company !== company) return false;
    if (!t) return true;
    return [s.firstName, s.lastName, s.company, s.jobTitle, s.email]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(t));
  });
  const groups = companies
    .map((co) => ({ co, rows: filtered.filter((s) => s.company === co) }))
    .filter((g) => g.rows.length > 0);

  async function toggle(s: ExternalSignerRow) {
    await fetch(`/api/external-signers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    router.refresh();
  }

  async function remove(s: ExternalSignerRow) {
    const msg = s.signs
      ? `${s.firstName} ${s.lastName} ha già firmato: verrà disattivato, non cancellato. Procedere?`
      : `Eliminare ${s.firstName} ${s.lastName}?`;
    if (!confirm(msg)) return;
    await fetch(`/api/external-signers/${s.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <div className="flex-inline" style={{ gap: 8, margin: "0 0 12px", flexWrap: "wrap" }}>
        <select
          className="input"
          style={{ maxWidth: 260 }}
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        >
          <option value="">Tutte le ditte ({companies.length})</option>
          {companies.map((co) => (
            <option key={co} value={co}>
              {co}
            </option>
          ))}
        </select>
        <label className="small flex-inline" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostra disattivati
        </label>
        {canManage && (
          <button className="btn-primary" style={{ marginLeft: "auto" }} onClick={() => setEdit("new")}>
            <Icon name="plus" size={15} /> Nuova persona esterna
          </button>
        )}
      </div>

      <div className="card no-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Qualifica</th>
                <th>Email</th>
                <th>Telefono</th>
                <th>Firme</th>
                <th>Accesso app</th>
                <th>Stato</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.co} company={g.co} rows={g.rows} canManage={canManage}
                  onEdit={setEdit} onToggle={toggle} onRemove={remove} onAccount={setAccountFor} />
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    Nessuna persona esterna. Si aggiungono qui o direttamente dall&apos;approvazione del collaudo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {accountFor && (
        <AccountModal
          signer={accountFor}
          onClose={() => setAccountFor(null)}
          onSaved={() => {
            setAccountFor(null);
            router.refresh();
          }}
        />
      )}

      {edit && (
        <ExternalModal
          signer={edit === "new" ? null : edit}
          companies={companies}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function GroupRows({
  company,
  rows,
  canManage,
  onEdit,
  onToggle,
  onRemove,
  onAccount,
}: {
  company: string;
  rows: ExternalSignerRow[];
  canManage: boolean;
  onEdit: (s: ExternalSignerRow) => void;
  onToggle: (s: ExternalSignerRow) => void;
  onRemove: (s: ExternalSignerRow) => void;
  onAccount: (s: ExternalSignerRow) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={8} style={{ background: "var(--surface)", fontWeight: 600 }}>
          <Icon name="people" size={13} /> {company} <span className="muted small">· {rows.length}</span>
        </td>
      </tr>
      {rows.map((s) => (
        <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
          <td>
            <div className="person-cell">
              <div className="user-avatar small">{initials(`${s.firstName} ${s.lastName}`)}</div>
              <span>
                {s.lastName} {s.firstName}
              </span>
            </div>
          </td>
          <td className="small">{s.jobTitle ?? "—"}</td>
          <td className="mono small">{s.email ?? "—"}</td>
          <td className="mono small">{s.phone ?? "—"}</td>
          <td className="mono">{s.signs}</td>
          <td>
            {s.account ? (
              <span className="small" title="Ruolo Collaudatore esterno: vede le macchine e compila il collaudo">
                <span className="mono">{s.account.email}</span>
                {!s.account.active && <span className="muted"> · disattivo</span>}
              </span>
            ) : canManage ? (
              <button className="btn-ghost-sm" onClick={() => onAccount(s)}>
                <Icon name="plus" size={13} /> Crea accesso
              </button>
            ) : (
              <span className="muted small">—</span>
            )}
          </td>
          <td>
            <span className="badge">
              <span className="badge-dot" style={{ background: s.active ? "var(--green)" : "var(--muted-2)" }} />
              {s.active ? "Attivo" : "Disattivo"}
            </span>
          </td>
          {canManage && (
            <td>
              <div className="flex-inline" style={{ gap: 6 }}>
                <button className="btn-ghost-sm" onClick={() => onEdit(s)}>
                  <Icon name="sign" size={13} /> Modifica
                </button>
                <button className="btn-ghost-sm" onClick={() => onToggle(s)}>
                  {s.active ? "Disattiva" : "Attiva"}
                </button>
                <button className="btn-ghost-sm danger" onClick={() => onRemove(s)} title="Elimina">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </td>
          )}
        </tr>
      ))}
    </>
  );
}

function ExternalModal({
  signer,
  companies,
  onClose,
  onSaved,
}: {
  signer: ExternalSignerRow | null;
  companies: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    firstName: signer?.firstName ?? "",
    lastName: signer?.lastName ?? "",
    company: signer?.company ?? "",
    jobTitle: signer?.jobTitle ?? "",
    email: signer?.email ?? "",
    phone: signer?.phone ?? "",
    notes: signer?.notes ?? "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    setErr("");
    const res = await fetch(signer ? `/api/external-signers/${signer.id}` : "/api/external-signers", {
      method: signer ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    setBusy(false);
    if (res.ok) return onSaved();
    const d = await res.json().catch(() => ({}));
    setErr(d.error || "Errore salvataggio");
  }

  const field = (k: keyof typeof f, label: string, extra?: { type?: string; list?: string }) => (
    <div className="form-row">
      <label>{label}</label>
      <input className="input" value={f[k]} type={extra?.type} list={extra?.list}
        onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{signer ? "Modifica persona esterna" : "Nuova persona esterna"}</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">
          {err && <div className="form-error">{err}</div>}
          <p className="muted small" style={{ marginTop: 0 }}>
            Non ha un account: firma sul dispositivo di chi raccoglie la firma (ad esempio l&apos;approvazione del collaudo).
          </p>
          <div className="form-grid">
            {field("firstName", "Nome")}
            {field("lastName", "Cognome")}
          </div>
          {field("company", "Ditta", { list: "ext-company-list" })}
          <datalist id="ext-company-list">
            {companies.map((co) => (
              <option key={co} value={co} />
            ))}
          </datalist>
          {field("jobTitle", "Qualifica (opzionale)")}
          <div className="form-grid">
            {field("email", "Email (opzionale)", { type: "email" })}
            {field("phone", "Telefono (opzionale)")}
          </div>
          <div className="form-row">
            <label>Note (opzionale)</label>
            <textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            <Icon name="check" size={14} /> {busy ? "Salvo…" : "Salva"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Crea l'accesso all'app per una persona esterna: ruolo Collaudatore esterno,
 * nome e ditta dalla scheda. Vedrà solo le macchine e, nel fascicolo, solo il
 * collaudo, dove compila e firma la check list.
 */
function AccountModal({
  signer,
  onClose,
  onSaved,
}: {
  signer: ExternalSignerRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(signer.email ?? "");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/external-signers/${signer.id}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) return onSaved();
    const d = await res.json().catch(() => ({}));
    setErr(d.error || "Errore creazione accesso");
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Accesso per {signer.firstName} {signer.lastName}</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">
          {err && <div className="form-error">{err}</div>}
          <p className="muted small" style={{ marginTop: 0 }}>
            Ruolo <strong>Collaudatore esterno</strong> ({signer.company}): vede l&apos;elenco macchine e, nel
            fascicolo, solo la linguetta Collaudo, dove compila e firma la check list. Non può modificare
            nient&apos;altro.
          </p>
          <div className="form-row">
            <label>Email (per entrare)</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Password (min 6)</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            <Icon name="check" size={14} /> {busy ? "Creo…" : "Crea accesso"}
          </button>
        </footer>
      </div>
    </div>
  );
}
