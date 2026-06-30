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
  matricola: string | null;
  badgeId: string | null;
  zona: string | null;
  phone: string | null;
  photo: string | null;
  reparto: string | null;
  signs: number;
  last: string | null;
};

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export default function PeopleClient({ users, isAdmin }: { users: U[]; isAdmin: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState(false);
  const [editUser, setEditUser] = useState<U | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function syncOperators() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/users/sync-timbratore", { method: "POST" });
      const d = await res.json().catch(() => null);
      setSyncMsg(res.ok ? `Creati ${d.created} · aggiornati ${d.updated} (${d.pages} pagine)` : d?.error ?? "Errore sync");
      if (res.ok) router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  const filtered = users.filter((u) => {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      u.name.toLowerCase().includes(t) ||
      u.email.toLowerCase().includes(t) ||
      (u.matricola ?? "").toLowerCase().includes(t) ||
      (u.badgeId ?? "").toLowerCase().includes(t)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const curPage = Math.min(page, totalPages);
  const paged = filtered.slice((curPage - 1) * perPage, curPage * perPage);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "MONTATORE" as Role,
    pin: "",
    badgeId: "",
    zona: "",
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
      setForm({ name: "", email: "", password: "", role: "MONTATORE", pin: "", badgeId: "", zona: "" });
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

  function BadgeCell({ user }: { user: U }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(user.badgeId ?? "");
    const [saving, setSaving] = useState(false);
    const [e, setE] = useState<string | null>(null);
    async function save() {
      setSaving(true);
      setE(null);
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, badgeId: val }),
      });
      setSaving(false);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setE(d.error || "Errore");
      }
    }
    if (!editing)
      return (
        <button className="badge-edit" onClick={() => setEditing(true)} title="Modifica matricola">
          <span className="mono small">{user.badgeId ?? "—"}</span>
          <Icon name="sign" size={12} />
        </button>
      );
    return (
      <span className="flex-inline" style={{ gap: 6 }}>
        <input
          className="input mono"
          style={{ width: 90, padding: "4px 7px", fontSize: 12 }}
          value={val}
          onChange={(ev) => setVal(ev.target.value)}
          autoFocus
        />
        <button className="btn-ghost-sm" onClick={save} disabled={saving}>
          {saving ? "…" : "OK"}
        </button>
        {e && <span className="muted small">{e}</span>}
      </span>
    );
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Persone &amp; Firme</h1>
          <p>Operatori autorizzati ad accedere e firmare gli interventi</p>
        </div>
        {isAdmin && (
          <div className="flex-inline" style={{ gap: 8 }}>
            {syncMsg && <span className="muted small">{syncMsg}</span>}
            <button className="btn-ghost" onClick={syncOperators} disabled={syncing}>
              <Icon name="download" size={15} /> {syncing ? "Sincronizzo…" : "Sincronizza dal timbratore"}
            </button>
            <button className="btn-primary" onClick={() => setModal(true)}>
              <Icon name="plus" size={15} /> Nuovo operatore
            </button>
          </div>
        )}
      </div>

      <div className="gantt-toolbar">
        <div className="search" style={{ maxWidth: 300 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input
            placeholder="Cerca nome, email, matricola, badge…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <span className="flex-inline" style={{ gap: 8, marginLeft: "auto" }}>
          <span className="muted small">Righe</span>
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", font: "inherit", fontSize: 13 }}
          >
            {[10, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button className="btn-ghost-sm" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>
            ‹
          </button>
          <span className="muted small mono">
            {filtered.length === 0 ? 0 : (curPage - 1) * perPage + 1}–{Math.min(curPage * perPage, filtered.length)} / {filtered.length}
          </span>
          <button className="btn-ghost-sm" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>
            ›
          </button>
        </span>
      </div>

      <div className="card no-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Ruolo</th>
                <th>Matricola</th>
                <th>Badge</th>
                <th>Zona</th>
                <th>Firme</th>
                <th>PIN</th>
                <th>Stato</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {paged.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="person-cell">
                      {u.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="user-avatar small" src={u.photo} alt={u.name} style={{ objectFit: "cover" }} />
                      ) : (
                        <div className="user-avatar small">{initials(u.name)}</div>
                      )}
                      <span>{u.name}</span>
                    </div>
                  </td>
                  <td className="mono small">{u.email}</td>
                  <td>{u.roleLabel}</td>
                  <td className="mono small">{u.matricola ?? "—"}</td>
                  <td>
                    {isAdmin ? (
                      <BadgeCell user={u} />
                    ) : (
                      <span className="mono small">{u.badgeId ?? "—"}</span>
                    )}
                  </td>
                  <td className="small">{u.zona ?? "—"}</td>
                  <td className="mono">{u.signs}</td>
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
                      <div className="flex-inline" style={{ gap: 6 }}>
                        <button className="btn-ghost-sm" onClick={() => setEditUser(u)}>
                          <Icon name="sign" size={13} /> Modifica
                        </button>
                        <button className="btn-ghost-sm" onClick={() => toggleActive(u)}>
                          {u.active ? "Disattiva" : "Attiva"}
                        </button>
                      </div>
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
              <div className="form-row">
                <label>Matricola / badge (per timbrature presenze, opzionale)</label>
                <input
                  className="input mono"
                  value={form.badgeId}
                  onChange={(e) => setForm({ ...form, badgeId: e.target.value })}
                  placeholder="Es. 0427"
                />
              </div>
              <div className="form-row">
                <label>Zona operativa (opzionale)</label>
                <input
                  className="input"
                  value={form.zona}
                  onChange={(e) => setForm({ ...form, zona: e.target.value })}
                  placeholder="Nord-Ovest, Centro…"
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

      {editUser && <EditEmployeeModal user={editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}

async function fileToResizedDataUrl(file: File, max = 320): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function EditEmployeeModal({ user, onClose }: { user: U; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    role: user.role,
    reparto: user.reparto ?? "",
    matricola: user.matricola ?? "",
    badgeId: user.badgeId ?? "",
    zona: user.zona ?? "",
    pin: "",
    password: "",
  });
  const [photo, setPhoto] = useState<string | null>(user.photo);
  const [saving, setSaving] = useState(false);
  const [e, setE] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function onPhoto(file: File | null) {
    if (!file) return;
    try {
      setPhoto(await fileToResizedDataUrl(file));
    } catch {
      setE("Immagine non valida");
    }
  }

  async function save() {
    setSaving(true);
    setE(null);
    try {
      const body: Record<string, unknown> = {
        id: user.id,
        name: f.name,
        email: f.email,
        phone: f.phone,
        role: f.role,
        reparto: f.reparto,
        matricola: f.matricola,
        badgeId: f.badgeId,
        zona: f.zona,
      };
      if (photo !== user.photo) body.photo = photo ?? "";
      if (f.pin && /^\d{4,6}$/.test(f.pin)) body.pin = f.pin;
      if (f.password && f.password.length >= 6) body.password = f.password;
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setE(d.error || "Errore salvataggio");
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <header className="modal-header">
          <h2>Anagrafica dipendente</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">
          {e && <div className="form-error">{e}</div>}

          <div className="emp-photo-row">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="emp-photo" src={photo} alt="foto" />
            ) : (
              <div className="emp-photo emp-photo-empty">{initials(f.name)}</div>
            )}
            <div className="flex-inline" style={{ gap: 8 }}>
              <label className="btn-ghost-sm" style={{ cursor: "pointer" }}>
                <Icon name="camera" size={13} /> Carica foto
                <input type="file" accept="image/*" hidden onChange={(ev) => onPhoto(ev.target.files?.[0] ?? null)} />
              </label>
              {photo && (
                <button className="btn-ghost-sm" onClick={() => setPhoto(null)}>
                  Rimuovi
                </button>
              )}
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>Nome e cognome</label>
              <input className="input" value={f.name} onChange={(ev) => set("name", ev.target.value)} />
            </div>
            <div className="form-row">
              <label>Email</label>
              <input className="input" type="email" value={f.email} onChange={(ev) => set("email", ev.target.value)} />
            </div>
            <div className="form-row">
              <label>Telefono</label>
              <input className="input" value={f.phone} onChange={(ev) => set("phone", ev.target.value)} placeholder="+39 …" />
            </div>
            <div className="form-row">
              <label>Ruolo</label>
              <select className="input" value={f.role} onChange={(ev) => set("role", ev.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Matricola</label>
              <input className="input mono" value={f.matricola} onChange={(ev) => set("matricola", ev.target.value)} />
            </div>
            <div className="form-row">
              <label>Badge RFID</label>
              <input className="input mono" value={f.badgeId} onChange={(ev) => set("badgeId", ev.target.value)} />
            </div>
            <div className="form-row">
              <label>Reparto</label>
              <input className="input" value={f.reparto} onChange={(ev) => set("reparto", ev.target.value)} placeholder="PRO, APV, UTE…" />
            </div>
            <div className="form-row">
              <label>Zona operativa</label>
              <input className="input" value={f.zona} onChange={(ev) => set("zona", ev.target.value)} placeholder="Nord-Ovest…" />
            </div>
            <div className="form-row">
              <label>Nuovo PIN firma (opzionale)</label>
              <input
                className="input mono pin-input"
                value={f.pin}
                maxLength={6}
                onChange={(ev) => set("pin", ev.target.value.replace(/\D/g, ""))}
                placeholder="••••"
              />
            </div>
            <div className="form-row">
              <label>Nuova password (opzionale, min 6)</label>
              <input className="input" type="password" value={f.password} onChange={(ev) => set("password", ev.target.value)} />
            </div>
          </div>
        </div>
        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" disabled={saving} onClick={save}>
            <Icon name="check" size={14} /> {saving ? "Salvo…" : "Salva"}
          </button>
        </footer>
      </div>
    </div>
  );
}
