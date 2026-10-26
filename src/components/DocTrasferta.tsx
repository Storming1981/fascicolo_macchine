"use client";
import { useState } from "react";
import Icon from "@/components/Icon";
import { A1_COLOR, TRASFERTA_DOC_KINDS, TRASFERTA_LABEL } from "@/lib/domain";
import { fmtDate } from "@/lib/format";

export type TrasfertaDoc = {
  id: string;
  name: string;
  path: string;
  category: string;
  sizeBytes: number | null;
  userName: string | null;
  uploadedByName: string | null;
  createdAt: string;
};

/**
 * Cartella **documenti di trasferta** dell'intervento: dentro ci sono i
 * documenti che l'ufficio prepara perché i tecnici possano stare in cantiere —
 * oggi il certificato **A1** e la **Dichiarazione Stato UE**, un file per
 * tecnico. Ogni intervento ha la sua, anche vuota: è un elenco da riempire,
 * non un allegato facoltativo.
 *
 * I due tipi stanno in **una card sola** perché li carica la stessa persona,
 * nello stesso momento, per le stesse trasferte: due riquadri separati
 * avrebbero raddoppiato lo spazio per lo stesso gesto.
 *
 * Chi la riempie non si sceglie qui: è chi ha il flag in anagrafica, per tutti
 * gli interventi — come il validatore del P.O.S.
 */
export default function DocTrasferta({
  interventoId,
  docs,
  managers,
  team,
  canUpload,
  onDone,
}: {
  interventoId: string;
  docs: TrasfertaDoc[];
  /** Chi tiene questi documenti (flag in anagrafica): si mostra a chi chiedere. */
  managers: { id: string; name: string }[];
  /** Squadra del cantiere: a chi si riferisce ogni documento. */
  team: { id: string; name: string }[];
  canUpload: boolean;
  onDone: () => void;
}) {
  // Un caricamento per volta, ma lo stato è per tipo: con un solo `files`
  // condiviso, scegliendo un file nella seconda cartella sparirebbe dalla prima.
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [perTech, setPerTech] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fmtSize = (n: number | null) =>
    n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  const chi = managers.map((m) => m.name).join(", ");

  async function upload(kind: string) {
    const list = files[kind] ?? [];
    if (!list.length) return;
    setBusy(kind);
    setErr(null);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      fd.append("kind", kind);
      if (perTech[kind]) fd.append("userId", perTech[kind]);
      const res = await fetch(`/api/interventi/${interventoId}/a1`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel caricamento.");
        return;
      }
      setFiles((s) => ({ ...s, [kind]: [] }));
      setPerTech((s) => ({ ...s, [kind]: "" }));
      onDone();
    } finally {
      setBusy(null);
    }
  }

  async function remove(docId: string, label: string) {
    if (!confirm(`Eliminare questo documento (${label})?`)) return;
    setBusy(docId);
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
      setBusy(null);
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
            }}
          >
            <Icon name="doc" size={15} />
          </span>
          {TRASFERTA_LABEL}
        </h3>
        <span className="status-chip" style={{ background: A1_COLOR + "1f", color: A1_COLOR }}>
          {docs.length === 0 ? "Cartella vuota" : `${docs.length} file`}
        </span>
      </div>

      <div className="info-banner" style={{ marginBottom: 12 }}>
        <Icon name="doc" size={15} />
        <span>
          Documenti richiesti per la presenza dei nostri tecnici in cantiere: un file per
          tecnico. Ogni intervento ha la sua cartella.
        </span>
      </div>

      {managers.length > 0 && (
        <div className="muted small" style={{ marginBottom: 14 }}>
          <Icon name="people" size={13} /> Gestiti da <strong>{chi}</strong> (impostato in Persone
          &amp; Firme).
        </div>
      )}

      {err && <div className="form-error">{err}</div>}

      {TRASFERTA_DOC_KINDS.map((kind) => {
        const list = docs.filter((d) => d.category === kind.key);
        const chosen = files[kind.key] ?? [];
        return (
          <div
            key={kind.key}
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <strong style={{ color: A1_COLOR }}>{kind.label}</strong>
              <span className="muted small">{kind.descr}</span>
              <span style={{ flex: 1 }} />
              <span className="muted small mono">{list.length}</span>
            </div>

            {canUpload && (
              <div className="doc-upload">
                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    setFiles((s) => ({ ...s, [kind.key]: Array.from(e.target.files ?? []) }))
                  }
                />
                {team.length > 0 && (
                  <select
                    value={perTech[kind.key] ?? ""}
                    onChange={(e) =>
                      setPerTech((s) => ({ ...s, [kind.key]: e.target.value }))
                    }
                  >
                    <option value="">— Tecnico (facoltativo) —</option>
                    {team.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="btn-primary-sm"
                  onClick={() => upload(kind.key)}
                  disabled={busy !== null || !chosen.length}
                >
                  <Icon name="upload" size={13} />{" "}
                  {busy === kind.key ? "Caricamento…" : `Carica${chosen.length ? ` (${chosen.length})` : ""}`}
                </button>
              </div>
            )}

            {list.length === 0 ? (
              <div className="muted small">
                Nessun file{chi ? `: in attesa di ${chi}.` : "."}
              </div>
            ) : (
              <ul className="doc-list">
                {list.map((d) => (
                  <li className="doc-row" key={d.id}>
                    <Icon name="doc" size={16} color={A1_COLOR} />
                    <a href={d.path} target="_blank" rel="noreferrer" className="doc-name">
                      {d.name}
                    </a>
                    {d.userName && (
                      <span
                        className="type-chip"
                        style={{ background: A1_COLOR + "1f", color: A1_COLOR }}
                      >
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
                        onClick={() => remove(d.id, kind.label)}
                        disabled={busy !== null}
                        aria-label="Elimina"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
