"use client";
import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { POS_CATEGORY } from "@/lib/domain";

export type PosDoc = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number | null;
  uploadedByName: string | null;
  createdAt: string;
};

export type PosState = {
  validated: boolean;
  validatedAt: string | null;
  validatedByName: string | null;
  signature: string | null;
  note: string | null;
};

/**
 * Card P.O.S. — Piano Operativo di Sicurezza.
 *
 * È il documento che sblocca l'intervento: si carica il file (di norma il Word
 * di ZATO con intestazione cliente compilata a mano) e il responsabile lo
 * valida con flag + firma. Finché non è validato l'intervento resta in
 * "Documentazione da validare" e non si può assegnare né pianificare.
 */
export default function PosCard({
  interventoId,
  doc,
  state,
  canEdit,
  canValidate,
  onDone,
}: {
  interventoId: string;
  doc: PosDoc | null;
  state: PosState;
  canEdit: boolean;
  canValidate: boolean;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // validazione responsabile
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"pen" | "pin">("pen");
  const [pin, setPin] = useState("");
  const padRef = useRef<SignaturePadHandle>(null);

  const fmtSize = (n: number | null) =>
    n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("files", file);
      fd.append("category", POS_CATEGORY);
      const res = await fetch(`/api/interventi/${interventoId}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel caricamento.");
        return;
      }
      setFile(null);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc() {
    if (!doc) return;
    if (!confirm("Eliminare il P.O.S. caricato?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/interventi/${interventoId}/documents?docId=${doc.id}`, {
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

  async function validate() {
    setBusy(true);
    setErr(null);
    try {
      const signature = mode === "pen" ? padRef.current?.toDataURL() : undefined;
      if (mode === "pen" && padRef.current?.isEmpty()) {
        setErr("Firma il documento prima di validare.");
        return;
      }
      const res = await fetch(`/api/interventi/${interventoId}/pos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed,
          note,
          signature: mode === "pen" ? signature : undefined,
          pin: mode === "pin" ? pin : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nella validazione.");
        return;
      }
      setConfirmed(false);
      setPin("");
      setNote("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (
      !confirm(
        "Revocare la validazione del P.O.S.? L'intervento tornerà in “Documentazione da validare” e non sarà più pianificabile."
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/interventi/${interventoId}/pos`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nella revoca.");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16, borderTop: `3px solid ${state.validated ? "#10b981" : "#d97706"}` }}>
      <div className="card-header">
        <h3>P.O.S. — Piano Operativo di Sicurezza</h3>
        {state.validated ? (
          <span className="status-chip" style={{ background: "#10b98122", color: "#0a7d52" }}>
            <Icon name="check" size={11} /> Validato
            {state.validatedAt ? ` · ${new Date(state.validatedAt).toLocaleDateString("it-IT")}` : ""}
          </span>
        ) : (
          <span className="status-chip" style={{ background: "#d9770622", color: "#b45309" }}>
            {doc ? "In attesa di validazione" : "Documento mancante"}
          </span>
        )}
      </div>

      <div className="info-banner" style={{ marginBottom: 12 }}>
        <Icon name="flag" size={15} />
        <span>
          Documento obbligatorio: finché non è caricato e <strong>validato dal responsabile</strong>{" "}
          (flag + firma) l&apos;intervento resta in <em>Documentazione da validare</em> e non può
          essere assegnato né pianificato. Gli altri documenti non hanno vincoli.
        </span>
      </div>

      {/* File del P.O.S. */}
      {doc ? (
        <ul className="doc-list">
          <li className="doc-row">
            <Icon name="doc" size={16} color="var(--muted)" />
            <a href={doc.path} target="_blank" rel="noreferrer" className="doc-name">
              {doc.name}
            </a>
            <span style={{ flex: 1 }} />
            <span className="muted small">
              {fmtSize(doc.sizeBytes)} · {new Date(doc.createdAt).toLocaleDateString("it-IT")}
              {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
            </span>
            {canEdit && !state.validated && (
              <button className="icon-btn sm" onClick={removeDoc} disabled={busy} aria-label="Elimina">
                <Icon name="trash" size={14} />
              </button>
            )}
          </li>
        </ul>
      ) : canEdit ? (
        <div className="doc-upload">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            accept=".doc,.docx,.pdf,.odt"
          />
          <button className="btn-primary-sm" onClick={upload} disabled={busy || !file}>
            <Icon name="upload" size={13} /> {busy ? "Caricamento…" : "Carica P.O.S."}
          </button>
        </div>
      ) : (
        <div className="muted small">Nessun P.O.S. caricato.</div>
      )}

      {err && <div className="form-error" style={{ marginTop: 10 }}>{err}</div>}

      {/* Validazione del responsabile */}
      {state.validated ? (
        <div className="field" style={{ marginTop: 14 }}>
          <span className="field-label">Validazione responsabile</span>
          <div className="readout" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Icon name="check" size={15} color="#0a7d52" />
            <span>
              <strong>{state.validatedByName ?? "—"}</strong>
              {state.validatedAt
                ? ` · ${new Date(state.validatedAt).toLocaleString("it-IT")}`
                : ""}
            </span>
            {state.signature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.signature} alt="firma responsabile" style={{ height: 48 }} />
            )}
          </div>
          {state.note && <div className="muted small" style={{ marginTop: 6 }}>{state.note}</div>}
          {canValidate && (
            <div style={{ marginTop: 10 }}>
              <button className="btn-ghost-sm" onClick={revoke} disabled={busy}>
                <Icon name="x" size={13} /> Revoca validazione
              </button>
            </div>
          )}
        </div>
      ) : canValidate ? (
        <div className="field" style={{ marginTop: 14 }}>
          <span className="field-label">Validazione responsabile</span>
          {!doc ? (
            <div className="muted small">Carica prima il documento P.O.S.</div>
          ) : (
            <>
              <label className="flex-inline" style={{ gap: 8, cursor: "pointer", marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  Confermo di aver verificato il P.O.S. e ne autorizzo la pianificazione
                </span>
              </label>

              <div className="seg-tabs" style={{ marginBottom: 10 }}>
                <button
                  className={"seg-tab" + (mode === "pen" ? " active" : "")}
                  onClick={() => setMode("pen")}
                  type="button"
                >
                  Firma a penna
                </button>
                <button
                  className={"seg-tab" + (mode === "pin" ? " active" : "")}
                  onClick={() => setMode("pin")}
                  type="button"
                >
                  PIN personale
                </button>
              </div>

              {mode === "pen" ? (
                <div>
                  <SignaturePad ref={padRef} height={130} />
                  <button
                    className="btn-ghost-sm"
                    type="button"
                    style={{ marginTop: 6 }}
                    onClick={() => padRef.current?.clear()}
                  >
                    Cancella firma
                  </button>
                </div>
              ) : (
                <input
                  className="mono pin-input"
                  value={pin}
                  maxLength={6}
                  placeholder="••••"
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              )}

              <input
                style={{ marginTop: 10 }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Nota (facoltativa)"
              />

              <div style={{ marginTop: 10 }}>
                <button className="btn-primary-sm" onClick={validate} disabled={busy || !confirmed}>
                  <Icon name="sign" size={13} /> {busy ? "Validazione…" : "Valida P.O.S."}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="muted small" style={{ marginTop: 14 }}>
          In attesa della validazione del responsabile abilitato.
        </div>
      )}
    </section>
  );
}
