"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  INTERVENTO_STATUS_META,
  INTERVENTO_STATUS_ORDER,
  PRIORITY_META,
} from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

type Ricambio = { code: string; desc: string; qty: string; note: string };
type Data = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: InterventoStatus;
  priority: number;
  channel: string | null;
  reportedBy: string | null;
  customerName: string | null;
  siteName: string | null;
  machine: { id: string; code: string; job: string; model: string } | null;
  techId: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  photos: { id: string; path: string; caption: string | null }[];
  rapportino: {
    workDescription: string | null;
    ricambi: Ricambio[];
    hoursWorked: number | null;
    techName: string | null;
    techSignature: string | null;
    clientName: string | null;
    clientSignature: string | null;
    closed: boolean;
    diaryEventId: string | null;
    hash: string | null;
  } | null;
};
type Tech = { id: string; name: string; zona: string | null };
type MachineOpt = { id: string; code: string; job: string; customer: string };

export default function InterventoDetail({
  data,
  techs,
  machines,
  currentUserName,
  canEdit,
  canSign,
}: {
  data: Data;
  techs: Tech[];
  machines: MachineOpt[];
  currentUserName: string;
  canEdit: boolean;
  canSign: boolean;
}) {
  const router = useRouter();
  const closed = data.rapportino?.closed ?? false;
  const meta = INTERVENTO_STATUS_META[data.status];
  const prio = PRIORITY_META[data.priority] ?? PRIORITY_META[3];

  // --- anagrafica intervento ---
  const [savingMeta, setSavingMeta] = useState(false);
  async function patch(body: Record<string, unknown>) {
    setSavingMeta(true);
    try {
      await fetch(`/api/interventi/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setSavingMeta(false);
    }
  }

  // --- rapportino ---
  const [workDescription, setWorkDescription] = useState(
    data.rapportino?.workDescription ?? ""
  );
  const [ricambi, setRicambi] = useState<Ricambio[]>(
    data.rapportino?.ricambi?.length
      ? data.rapportino.ricambi
      : [{ code: "", desc: "", qty: "", note: "" }]
  );
  const [hours, setHours] = useState(
    data.rapportino?.hoursWorked != null ? String(data.rapportino.hoursWorked) : ""
  );
  const [techName, setTechName] = useState(data.rapportino?.techName ?? currentUserName);
  const [clientName, setClientName] = useState(data.rapportino?.clientName ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const techSig = useRef<SignaturePadHandle>(null);
  const clientSig = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState<"draft" | "close" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function setRic(i: number, k: keyof Ricambio, v: string) {
    setRicambi((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  }
  function addRic() {
    setRicambi((rs) => [...rs, { code: "", desc: "", qty: "", note: "" }]);
  }
  function delRic(i: number) {
    setRicambi((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function saveRapportino(finalize: boolean) {
    setErr(null);
    const fd = new FormData();
    fd.set("workDescription", workDescription);
    fd.set(
      "ricambi",
      JSON.stringify(ricambi.filter((r) => r.code.trim() || r.desc.trim()))
    );
    fd.set("hoursWorked", hours);
    fd.set("techName", techName);
    fd.set("clientName", clientName);
    if (techSig.current && !techSig.current.isEmpty())
      fd.set("techSignature", techSig.current.toDataURL() ?? "");
    if (clientSig.current && !clientSig.current.isEmpty())
      fd.set("clientSignature", clientSig.current.toDataURL() ?? "");
    for (const f of files) fd.append("photos", f);
    if (finalize) fd.set("finalize", "1");

    setBusy(finalize ? "close" : "draft");
    try {
      const res = await fetch(`/api/interventi/${data.id}/rapportino`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel salvataggio.");
        return;
      }
      setFiles([]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <Link href="/service/interventi" className="back-link">
            <Icon name="arrow-left" size={14} /> Interventi
          </Link>
          <h1>
            <span className="mono muted" style={{ fontSize: 15, marginRight: 10 }}>
              {data.code}
            </span>
            {data.title}
          </h1>
          <div className="chip-row">
            <span className="status-chip" style={{ background: meta.color + "22", color: meta.color }}>
              {meta.label}
            </span>
            <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>
              {prio.label}
            </span>
            {data.channel && <span className="muted small">via {data.channel}</span>}
          </div>
        </div>
      </div>

      <div className="grid-two">
        {/* Anagrafica intervento */}
        <section className="card">
          <div className="card-header">
            <h3>Dati intervento</h3>
            {savingMeta && <span className="muted small">Salvataggio…</span>}
          </div>
          <div className="detail-grid">
            <Field label="Cliente">{data.customerName ?? "—"}</Field>
            <Field label="Cantiere">{data.siteName ?? "—"}</Field>
            <Field label="Segnalato da">{data.reportedBy ?? "—"}</Field>
            <Field label="Programmato">
              {data.scheduledStart
                ? new Date(data.scheduledStart).toLocaleString("it-IT")
                : "—"}
            </Field>

            <div className="field">
              <span className="field-label">Macchina (fascicolo)</span>
              {canEdit && !closed ? (
                <select
                  value={data.machine?.id ?? ""}
                  onChange={(e) => patch({ machineId: e.target.value || null })}
                >
                  <option value="">— Nessuna —</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.job || m.code} · {m.customer}
                    </option>
                  ))}
                </select>
              ) : data.machine ? (
                <Link href={`/macchine/${data.machine.code}`} className="link-strong">
                  {data.machine.job || data.machine.code}
                </Link>
              ) : (
                "—"
              )}
            </div>

            <div className="field">
              <span className="field-label">Tecnico</span>
              {canEdit && !closed ? (
                <select
                  value={data.techId ?? ""}
                  onChange={(e) => patch({ assignedTechId: e.target.value || null })}
                >
                  <option value="">— Da assegnare —</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.zona ? ` · ${t.zona}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                techs.find((t) => t.id === data.techId)?.name ?? "Da assegnare"
              )}
            </div>

            <div className="field">
              <span className="field-label">Priorità</span>
              {canEdit && !closed ? (
                <select
                  value={data.priority}
                  onChange={(e) => patch({ priority: Number(e.target.value) })}
                >
                  {[1, 2, 3].map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              ) : (
                prio.label
              )}
            </div>

            <div className="field">
              <span className="field-label">Stato</span>
              {canEdit && !closed ? (
                <select
                  value={data.status}
                  onChange={(e) => patch({ status: e.target.value as InterventoStatus })}
                >
                  {INTERVENTO_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {INTERVENTO_STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              ) : (
                meta.label
              )}
            </div>

            {data.description && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field-label">Descrizione segnalazione</span>
                <div className="readout">{data.description}</div>
              </div>
            )}
          </div>
        </section>

        {/* Rapportino */}
        <section className="card">
          <div className="card-header">
            <h3>Rapportino</h3>
            {closed ? (
              <span className="status-chip" style={{ background: "#10b98122", color: "#0a7d52" }}>
                <Icon name="check" size={12} /> Chiuso
              </span>
            ) : (
              <span className="muted small">Bozza</span>
            )}
          </div>

          {closed && data.rapportino?.diaryEventId && data.machine && (
            <div className="info-banner">
              <Icon name="check" size={15} />
              Registrato nel diario del fascicolo{" "}
              <Link href={`/macchine/${data.machine.code}`} className="link-strong">
                {data.machine.job || data.machine.code}
              </Link>{" "}
              come evento di manutenzione.
            </div>
          )}

          <div className="field">
            <span className="field-label">Attività eseguita</span>
            <textarea
              rows={4}
              value={workDescription}
              disabled={closed}
              onChange={(e) => setWorkDescription(e.target.value)}
              placeholder="Descrivi l'intervento eseguito sull'impianto…"
            />
          </div>

          <div className="field">
            <span className="field-label">Ricambi utilizzati</span>
            <table className="ric-table">
              <thead>
                <tr>
                  <th>Codice</th>
                  <th>Descrizione</th>
                  <th style={{ width: 56 }}>Q.tà</th>
                  <th>Note</th>
                  {!closed && <th style={{ width: 34 }}></th>}
                </tr>
              </thead>
              <tbody>
                {ricambi.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input value={r.code} disabled={closed} onChange={(e) => setRic(i, "code", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.desc} disabled={closed} onChange={(e) => setRic(i, "desc", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.qty} disabled={closed} onChange={(e) => setRic(i, "qty", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.note} disabled={closed} onChange={(e) => setRic(i, "note", e.target.value)} />
                    </td>
                    {!closed && (
                      <td>
                        <button className="icon-btn sm" onClick={() => delRic(i)} aria-label="Rimuovi">
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!closed && (
              <button className="btn-ghost-sm" onClick={addRic} style={{ marginTop: 8 }}>
                <Icon name="plus" size={13} /> Aggiungi ricambio
              </button>
            )}
          </div>

          <div className="field" style={{ maxWidth: 200 }}>
            <span className="field-label">Ore lavorate</span>
            <input value={hours} disabled={closed} onChange={(e) => setHours(e.target.value)} placeholder="es. 2.5" />
          </div>

          {/* Foto */}
          <div className="field">
            <span className="field-label">Foto cantiere</span>
            {data.photos.length > 0 && (
              <div className="photo-grid-sm">
                {data.photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={p.id} href={p.path} target="_blank" rel="noreferrer">
                    <img src={p.path} alt={p.caption ?? ""} />
                  </a>
                ))}
              </div>
            )}
            {!closed && (
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                style={{ marginTop: 8 }}
              />
            )}
            {files.length > 0 && <div className="muted small">{files.length} foto da caricare</div>}
          </div>

          {/* Firme */}
          <div className="sig-row">
            <div className="field">
              <span className="field-label">Firma tecnico</span>
              {closed && data.rapportino?.techSignature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sig-readout" src={data.rapportino.techSignature} alt="firma tecnico" />
              ) : (
                <>
                  <SignaturePad ref={techSig} height={120} />
                  <button className="btn-ghost-sm" onClick={() => techSig.current?.clear()} type="button">
                    Pulisci
                  </button>
                </>
              )}
              <input
                value={techName}
                disabled={closed}
                onChange={(e) => setTechName(e.target.value)}
                placeholder="Nome tecnico"
                style={{ marginTop: 6 }}
              />
            </div>
            <div className="field">
              <span className="field-label">Firma cliente</span>
              {closed && data.rapportino?.clientSignature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sig-readout" src={data.rapportino.clientSignature} alt="firma cliente" />
              ) : (
                <>
                  <SignaturePad ref={clientSig} height={120} />
                  <button className="btn-ghost-sm" onClick={() => clientSig.current?.clear()} type="button">
                    Pulisci
                  </button>
                </>
              )}
              <input
                value={clientName}
                disabled={closed}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nome cliente"
                style={{ marginTop: 6 }}
              />
            </div>
          </div>

          {closed && data.rapportino?.hash && (
            <div className="muted small mono">SHA256 · {data.rapportino.hash.slice(0, 16)}…</div>
          )}
          {err && <div className="form-error">{err}</div>}

          {!closed && canSign && (
            <div className="rapportino-actions">
              <button className="btn-ghost" onClick={() => saveRapportino(false)} disabled={busy !== null}>
                {busy === "draft" ? "Salvataggio…" : "Salva bozza"}
              </button>
              <button className="btn-primary" onClick={() => saveRapportino(true)} disabled={busy !== null}>
                <Icon name="check" size={15} />
                {busy === "close" ? "Chiusura…" : "Chiudi e firma"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="readout">{children}</div>
    </div>
  );
}
