"use client";
import { useState } from "react";
import Icon from "@/components/Icon";
import { A1_CATEGORY, A1_COLOR, A1_LABEL } from "@/lib/domain";
import { fmtDate, fmtDateTime } from "@/lib/format";

export type A1Doc = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number | null;
  userName: string | null;
  uploadedByName: string | null;
  createdAt: string;
};

export type A1State = {
  assigneeId: string | null;
  assigneeName: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
  note: string | null;
};

/**
 * Cartella **A1** dell'intervento: ci sta un documento per tecnico, fra quelli
 * richiesti per la loro presenza in cantiere. Ogni intervento ha la sua, anche
 * vuota — è l'elenco che qualcuno deve riempire, non un allegato facoltativo.
 *
 * Il compito si affida a una persona precisa (`a1Assignee`), che da quel
 * momento può caricare qui **anche senza** i permessi di gestione interventi:
 * di solito è l'ufficio, non chi segue i cantieri.
 */
export default function A1Card({
  interventoId,
  docs,
  state,
  team,
  people,
  canAssign,
  canUpload,
  onDone,
}: {
  interventoId: string;
  docs: A1Doc[];
  state: A1State;
  /** Squadra del cantiere: a chi si riferisce ogni documento. */
  team: { id: string; name: string }[];
  /** Persone a cui si può affidare il caricamento. */
  people: { id: string; name: string }[];
  canAssign: boolean;
  canUpload: boolean;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [perTech, setPerTech] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignee, setAssignee] = useState(state.assigneeId ?? "");
  const [note, setNote] = useState(state.note ?? "");

  const fmtSize = (n: number | null) =>
    n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      fd.append("category", A1_CATEGORY);
      if (perTech) fd.append("userId", perTech);
      const res = await fetch(`/api/interventi/${interventoId}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel caricamento.");
        return;
      }
      setFiles([]);
      setPerTech("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function remove(docId: string) {
    if (!confirm("Eliminare questo documento A1?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/interventi/${interventoId}/documents?docId=${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nell'eliminazione.");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignee() {
    if (!assignee) {
      setErr("Scegli chi deve caricare i documenti A1.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/interventi/${interventoId}/a1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: assignee, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nell'assegnazione.");
        return;
      }
      setAssignOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function clearAssignee() {
    if (!confirm("Togliere l'incarico? I documenti già caricati restano.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/interventi/${interventoId}/a1`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore.");
        return;
      }
      setAssignee("");
      setAssignOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="card"
      style={{ marginTop: 16, borderLeft: `5px solid ${A1_COLOR}`, background: A1_COLOR + "08" }}
    >
      <div className="card-header">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 7,
              background: A1_COLOR,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".02em",
            }}
          >
            A1
          </span>
          {A1_LABEL}
        </h3>
        <span
          className="status-chip"
          style={{ background: A1_COLOR + "1f", color: A1_COLOR }}
        >
          {docs.length === 0 ? "Cartella vuota" : `${docs.length} file`}
        </span>
      </div>

      <div className="info-banner" style={{ marginBottom: 12 }}>
        <Icon name="doc" size={15} />
        <span>
          Cartella dedicata ai <strong>documenti A1</strong> richiesti per la presenza dei nostri
          tecnici in cantiere: un documento per tecnico. Ogni intervento ha la sua.
        </span>
      </div>

      {/* Incaricato del caricamento */}
      <div className="field" style={{ marginBottom: 12 }}>
        <span className="field-label">Incaricato del caricamento</span>
        {state.assigneeId && !assignOpen ? (
          <div className="readout" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="people" size={15} color={A1_COLOR} />
            <strong>{state.assigneeName ?? "—"}</strong>
            {state.assignedAt && (
              <span className="muted small">
                · incaricato il {fmtDateTime(state.assignedAt)}
                {state.assignedByName ? ` da ${state.assignedByName}` : ""}
              </span>
            )}
            {canAssign && (
              <>
                <span style={{ flex: 1 }} />
                <button className="btn-ghost-sm" onClick={() => setAssignOpen(true)} disabled={busy}>
                  <Icon name="sign" size={13} /> Cambia
                </button>
                <button className="btn-ghost-sm" onClick={clearAssignee} disabled={busy}>
                  <Icon name="x" size={13} /> Togli
                </button>
              </>
            )}
          </div>
        ) : canAssign ? (
          <>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">— Scegli chi deve caricarli —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              style={{ marginTop: 8 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Nota per l'incaricato (paese, scadenze, quali tecnici…)"
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button className="btn-primary-sm" onClick={saveAssignee} disabled={busy || !assignee}>
                <Icon name="check" size={13} /> {busy ? "Salvataggio…" : "Assegna il compito"}
              </button>
              {assignOpen && (
                <button className="btn-ghost-sm" onClick={() => setAssignOpen(false)} disabled={busy}>
                  Annulla
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="muted small">Nessun incaricato.</div>
        )}
        {state.note && !assignOpen && (
          <div className="muted small" style={{ marginTop: 6 }}>
            Nota: {state.note}
          </div>
        )}
      </div>

      {/* Caricamento */}
      {canUpload && (
        <div className="doc-upload">
          <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          {team.length > 0 && (
            <select value={perTech} onChange={(e) => setPerTech(e.target.value)}>
              <option value="">— Tecnico (facoltativo) —</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn-primary-sm" onClick={upload} disabled={busy || !files.length}>
            <Icon name="upload" size={13} />{" "}
            {busy ? "Caricamento…" : `Carica${files.length ? ` (${files.length})` : ""}`}
          </button>
        </div>
      )}
      {err && <div className="form-error">{err}</div>}

      {docs.length === 0 ? (
        <div className="muted small">
          Nessun documento A1 caricato
          {state.assigneeName ? `: in attesa di ${state.assigneeName}.` : "."}
        </div>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li className="doc-row" key={d.id}>
              <Icon name="doc" size={16} color={A1_COLOR} />
              <a href={d.path} target="_blank" rel="noreferrer" className="doc-name">
                {d.name}
              </a>
              {d.userName && (
                <span className="type-chip" style={{ background: A1_COLOR + "1f", color: A1_COLOR }}>
                  {d.userName}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <span className="muted small">
                {fmtSize(d.sizeBytes)} · {fmtDate(d.createdAt)}
                {d.uploadedByName ? ` · ${d.uploadedByName}` : ""}
              </span>
              {canUpload && (
                <button
                  className="icon-btn sm"
                  onClick={() => remove(d.id)}
                  disabled={busy}
                  aria-label="Elimina"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
