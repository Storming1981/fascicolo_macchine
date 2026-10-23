"use client";
import { useState } from "react";
import Icon from "@/components/Icon";
import { A1_COLOR, A1_LABEL } from "@/lib/domain";
import { fmtDate } from "@/lib/format";

export type A1Doc = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number | null;
  userName: string | null;
  uploadedByName: string | null;
  createdAt: string;
};



/**
 * Cartella **A1** dell'intervento: ci sta un documento per tecnico, fra quelli
 * richiesti per la loro presenza in cantiere. Ogni intervento ha la sua, anche
 * vuota — è l'elenco che qualcuno deve riempire, non un allegato facoltativo.
 *
 * Chi la riempie non si sceglie qui: è chi ha il flag *Gestisce i documenti A1*
 * in anagrafica, per tutti gli interventi — come il validatore del P.O.S.
 */
export default function A1Card({
  interventoId,
  docs,
  managers,
  team,
  canUpload,
  onDone,
}: {
  interventoId: string;
  docs: A1Doc[];
  /** Chi tiene gli A1 (flag in anagrafica): si mostra per sapere a chi chiedere. */
  managers: { id: string; name: string }[];
  /** Squadra del cantiere: a chi si riferisce ogni documento. */
  team: { id: string; name: string }[];
  canUpload: boolean;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [perTech, setPerTech] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fmtSize = (n: number | null) =>
    n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      if (perTech) fd.append("userId", perTech);
      const res = await fetch(`/api/interventi/${interventoId}/a1`, { method: "POST", body: fd });
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
      const res = await fetch(`/api/interventi/${interventoId}/a1?docId=${docId}`, {
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

      {managers.length > 0 && (
        <div className="muted small" style={{ marginBottom: 12 }}>
          <Icon name="people" size={13} /> Gestiti da{" "}
          <strong>{managers.map((m) => m.name).join(", ")}</strong> (impostato in Persone & Firme).
        </div>
      )}

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
          {managers.length ? `: in attesa di ${managers.map((m) => m.name).join(", ")}.` : "."}
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
