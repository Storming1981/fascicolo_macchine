"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { initials, ROLE_LABEL } from "@/lib/domain";
import { fmtDate } from "@/lib/format";
import type { Role } from "@prisma/client";

type U = {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  role: Role;
  active: boolean;
  hasPin: boolean;
  signs: number;
  last: string | null;
};

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export default function PeopleClient({ users, isAdmin }: { users: U[]; isAdmin: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "MONTATORE" as Role,
    pin: "",
  });

  async function create() {
    setErr("");
    setBusy(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.ok) {
      setModal(false);
      setForm({ name: "", email: "", password: "", role: "MONTATORE", pin: "" });
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Errore creazione operatore");
    }
  }

  async function toggleActive(u: U) {
    await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, active: !u.active }),
    });
    router.refresh();
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Persone &amp; Firme</h1>
          <p>Operatori autorizzati ad accedere e firmare gli interventi</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setModal(true)}>
            <Icon name="plus" size={15} /> Nuovo operatore
          </button>
        )}
      </div>

      <div className="card no-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Ruolo</th>
                <th>Firme</th>
                <th>Ultima firma</th>
                <th>PIN</th>
                <th>Stato</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="person-cell">
                      <div className="user-avatar small">{initials(u.name)}</div>
                      <span>{u.name}</span>
                    </div>
                  </td>
                  <td className="mono small">{u.email}</td>
                  <td>{u.roleLabel}</td>
                  <td className="mono">{u.signs}</td>
                  <td className="mono">{u.last ? fmtDate(u.last) : "—"}</td>
                  <td>
                    {u.hasPin ? (
                      <span className="badge">
                        <span className="badge-dot" style={{ background: "var(--green)" }} />
                        Attivo
                      </span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td>
                    <span className="badge">
                      <span
                        className="badge-dot"
                        style={{ background: u.active ? "var(--green)" : "var(--muted-2)" }}
                      />
                      {u.active ? "Attivo" : "Disattivo"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <button className="btn-ghost-sm" onClick={() => toggleActive(u)}>
                        {u.active ? "Disattiva" : "Attiva"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!isAdmin && (
        <p className="muted small" style={{ marginTop: 14 }}>
          Solo gli amministratori possono creare o modificare operatori.
        </p>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>Nuovo operatore</h2>
              <button className="icon-btn" onClick={() => setModal(false)}>
                <Icon name="x" size={18} />
              </button>
            </header>
            <div className="modal-body">
              {err && <div className="form-error">{err}</div>}
              <div className="form-row">
                <label>Nome e cognome</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>Email</label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>Password (min 6)</label>
                <input
                  className="input"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>Ruolo</label>
                <select
                  className="input"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>PIN firma (4-6 cifre, opzionale)</label>
                <input
                  className="input mono pin-input"
                  value={form.pin}
                  maxLength={6}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
                  placeholder="••••"
                />
              </div>
            </div>
            <footer className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(false)}>
                Annulla
              </button>
              <button className="btn-primary" disabled={busy} onClick={create}>
                <Icon name="check" size={14} /> {busy ? "Creo…" : "Crea operatore"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
