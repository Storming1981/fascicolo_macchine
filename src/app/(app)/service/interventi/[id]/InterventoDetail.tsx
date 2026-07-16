"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  CHECKLIST_DEFS,
  CHECKLIST_TYPES,
  checklistProgress,
  type ChecklistDef,
  type ChecklistType,
} from "@/lib/checklistInterventi";
import {
  INTERVENTO_STATUS_META,
  INTERVENTO_STATUS_ORDER,
  INTERVENTO_TYPE_META,
  INTERVENTO_TYPE_ORDER,
  interventoTypeMeta,
  PRIORITY_META,
} from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

type Ricambio = { code: string; desc: string; qty: string; note: string };
type Revision = {
  id: string;
  editedAt: string;
  editedByName: string;
  note: string | null;
  snapshot: {
    date?: string;
    workDescription?: string | null;
    hoursWorked?: number | null;
    techName?: string | null;
    clientName?: string | null;
  } | null;
};
type Rapportino = {
  id: string;
  date: string;
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
  revisions: Revision[];
};
type Data = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  commessa: string | null;
  status: InterventoStatus;
  type: string;
  priority: number;
  channel: string | null;
  reportedBy: string | null;
  customerName: string | null;
  siteName: string | null;
  machine: { id: string; code: string; job: string; model: string } | null;
  techId: string | null;
  participants: { id: string; name: string }[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedAt: string | null;
  photos: { id: string; path: string; caption: string | null }[];
  rapportini: Rapportino[];
  checklists: ChecklistState[];
};
type ChecklistState = {
  type: string;
  closed: boolean;
  pdfPath: string | null;
  compiledAt: string | null;
  compilerName: string | null;
  clientName: string | null;
  answers: Record<string, string>;
  fields: Record<string, string>;
  revisionsCount: number;
};
type Tech = { id: string; name: string; zona: string | null; siteManager: boolean };
type MachineOpt = { id: string; code: string; job: string; customer: string };
type Commessa = { code: string; label: string };

export default function InterventoDetail({
  data,
  techs,
  machines,
  commesse,
  currentUserName,
  canEdit,
  canSign,
  canChecklist = false,
  campo = false,
  backHref = "/service/interventi",
  machineBase = "/macchine",
}: {
  data: Data;
  techs: Tech[];
  machines: MachineOpt[];
  commesse: Commessa[];
  currentUserName: string;
  canEdit: boolean;
  canSign: boolean;
  canChecklist?: boolean;
  campo?: boolean;
  backHref?: string;
  machineBase?: string;
}) {
  const router = useRouter();
  const meta = INTERVENTO_STATUS_META[data.status];
  const prio = PRIORITY_META[data.priority] ?? PRIORITY_META[3];
  const tmeta = interventoTypeMeta(data.type);

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

  // commessa (con salvataggio on blur)
  const [commessa, setCommessa] = useState(data.commessa ?? "");
  const [title, setTitle] = useState(data.title);
  const [adding, setAdding] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState<ChecklistType | null>(null);

  const totHours = data.rapportini.reduce((n, r) => n + (r.hoursWorked ?? 0), 0);

  // Commesse suggerite: codice parlante derivato dal job macchina (base 7 cifre
  // + suffisso 01 installazione / 02 completamento / 04 riparazioni) + quelle
  // realmente timbrate nel gestionale presenze.
  const job = data.machine?.job?.replace(/\D/g, "") ?? "";
  const derived: Commessa[] =
    job.length >= 4
      ? [
          { code: `${job}01`, label: "Installazione (da job macchina)" },
          { code: `${job}02`, label: "Completamento (da job macchina)" },
          { code: `${job}04`, label: "Riparazioni (da job macchina)" },
        ]
      : [];
  const commessaOptions = [
    ...derived,
    ...commesse.filter((c) => !derived.some((d) => d.code === c.code)),
  ];

  // squadra: responsabile (supervisore = techId) + partecipanti
  const participantIds = data.participants.map((p) => p.id);
  function setParticipants(ids: string[]) {
    patch({ participantIds: ids, assignedTechId: data.techId });
  }

  // Ore timbrate sulla commessa (per giorno + totale) dal timbratore
  const [oreByDay, setOreByDay] = useState<Record<string, number>>({});
  const [oreTotal, setOreTotal] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const c = (data.commessa ?? "").trim();
    if (!c) {
      setOreByDay({});
      setOreTotal(null);
      return;
    }
    let alive = true;
    fetch(`/api/timbratore/ore?commessa=${encodeURIComponent(c)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) {
          setOreByDay(d.byDay ?? {});
          setOreTotal(typeof d.total === "number" ? d.total : null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [data.commessa]);

  async function syncOre() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/interventi/${data.id}/sync-ore`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (res.ok && d) {
        setOreByDay(d.byDay ?? {});
        setOreTotal(typeof d.total === "number" ? d.total : null);
      } else {
        alert(d?.error ?? "Errore nella sincronizzazione ore.");
      }
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <Link href={backHref} className="back-link">
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
            <span className="type-chip" style={{ background: tmeta.color + "1f", color: tmeta.color }}>
              {tmeta.label}
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
        <section className="card" style={{ alignSelf: "start" }}>
          <div className="card-header">
            <h3>Dati intervento</h3>
            {savingMeta && <span className="muted small">Salvataggio…</span>}
          </div>
          <div className="detail-grid">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="field-label">Titolo intervento</span>
              {canEdit ? (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    const t = title.trim();
                    if (t && t !== data.title) patch({ title: t });
                    else if (!t) setTitle(data.title);
                  }}
                  placeholder="Titolo intervento"
                />
              ) : (
                <div className="readout">{data.title}</div>
              )}
            </div>

            <Field label="Cliente">{data.customerName ?? "—"}</Field>
            <Field label="Cantiere">{data.siteName ?? "—"}</Field>
            <Field label="Segnalato da">{data.reportedBy ?? "—"}</Field>
            <div className="field">
              <span className="field-label">Programmato — Inizio</span>
              {canEdit ? (
                <input
                  type="datetime-local"
                  value={toLocalInput(data.scheduledStart)}
                  onChange={(e) =>
                    patch({ scheduledStart: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                />
              ) : (
                <span>{data.scheduledStart ? new Date(data.scheduledStart).toLocaleString("it-IT") : "—"}</span>
              )}
            </div>

            <div className="field">
              <span className="field-label">Programmato — Fine</span>
              {canEdit ? (
                <input
                  type="datetime-local"
                  value={toLocalInput(data.scheduledEnd)}
                  min={toLocalInput(data.scheduledStart) || undefined}
                  onChange={(e) =>
                    patch({ scheduledEnd: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                />
              ) : (
                <span>{data.scheduledEnd ? new Date(data.scheduledEnd).toLocaleString("it-IT") : "—"}</span>
              )}
            </div>

            <div className="field">
              <span className="field-label">Macchina (fascicolo)</span>
              {canEdit ? (
                <select value={data.machine?.id ?? ""} onChange={(e) => patch({ machineId: e.target.value || null })}>
                  <option value="">— Nessuna —</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.job || m.code} · {m.customer}
                    </option>
                  ))}
                </select>
              ) : data.machine ? (
                <Link href={`${machineBase}/${data.machine.code}`} className="link-strong">
                  {data.machine.job || data.machine.code}
                </Link>
              ) : (
                "—"
              )}
            </div>

            <div className="field">
              <span className="field-label">Commessa (cantiere · timbratore)</span>
              {canEdit ? (
                <>
                  <input
                    className="mono"
                    list="commessa-list"
                    value={commessa}
                    onChange={(e) => setCommessa(e.target.value)}
                    onBlur={() => commessa !== (data.commessa ?? "") && patch({ commessa })}
                    placeholder="es. 226024101"
                  />
                  <datalist id="commessa-list">
                    {commessaOptions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <span className="mono">{data.commessa ?? "—"}</span>
              )}
            </div>

            <div className="field">
              <span className="field-label">Responsabile di cantiere (supervisore)</span>
              {canEdit ? (
                <select
                  value={data.techId ?? ""}
                  onChange={(e) =>
                    patch({
                      assignedTechId: e.target.value || null,
                      // se diventa supervisore, toglilo dai partecipanti
                      participantIds: participantIds.filter((id) => id !== e.target.value),
                    })
                  }
                >
                  <option value="">— Da assegnare —</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.siteManager ? "★ " : ""}
                      {t.name}
                      {t.zona ? ` · ${t.zona}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                techs.find((t) => t.id === data.techId)?.name ?? "Da assegnare"
              )}
            </div>

            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="field-label">Tecnici partecipanti (squadra)</span>
              <div className="team-chips">
                {data.participants.length === 0 && <span className="muted small">Nessun partecipante</span>}
                {data.participants.map((p) => (
                  <span key={p.id} className="team-chip">
                    {p.name}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label="Rimuovi"
                        onClick={() => setParticipants(participantIds.filter((id) => id !== p.id))}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {canEdit && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setParticipants([...participantIds, e.target.value]);
                  }}
                  style={{ marginTop: 8 }}
                >
                  <option value="">+ Aggiungi tecnico…</option>
                  {techs
                    .filter((t) => t.id !== data.techId && !participantIds.includes(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.zona ? ` · ${t.zona}` : ""}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="field">
              <span className="field-label">Tipo intervento</span>
              {canEdit ? (
                <select
                  value={data.type}
                  onChange={(e) => patch({ type: e.target.value })}
                  style={{ borderLeft: `4px solid ${tmeta.color}` }}
                >
                  {INTERVENTO_TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {INTERVENTO_TYPE_META[t].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="type-chip" style={{ background: tmeta.color + "1f", color: tmeta.color }}>
                  {tmeta.label}
                </span>
              )}
            </div>

            <div className="field">
              <span className="field-label">Priorità</span>
              {canEdit ? (
                <select value={data.priority} onChange={(e) => patch({ priority: Number(e.target.value) })}>
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
              {canEdit ? (
                <select value={data.status} onChange={(e) => patch({ status: e.target.value as InterventoStatus })}>
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

            <div className="field">
              <span className="field-label">Ore totali (rapportini)</span>
              <div className="readout" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span>{totHours > 0 ? `${totHours} h` : "—"}</span>
                {data.commessa && oreTotal != null && (
                  <span className="muted small">
                    · Timbratore: <strong>{oreTotal} h</strong>
                  </span>
                )}
                {canEdit && data.commessa && (
                  <button className="btn-ghost-sm" onClick={syncOre} disabled={syncing}>
                    <Icon name="clock" size={13} /> {syncing ? "Sincronizzo…" : "Sincronizza ore"}
                  </button>
                )}
              </div>
            </div>

            {data.description && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field-label">Descrizione segnalazione</span>
                <div className="readout">{data.description}</div>
              </div>
            )}
          </div>
        </section>

        {/* Rapportini giornalieri */}
        <section className="card">
          <div className="card-header">
            <h3>Rapportini giornalieri</h3>
            {canSign && !adding && (
              <button className="btn-ghost-sm" onClick={() => setAdding(true)}>
                <Icon name="plus" size={13} /> Aggiungi giornata
              </button>
            )}
          </div>

          {data.rapportini.length === 0 && !adding && (
            <div className="muted small">Nessun rapportino. Aggiungi la prima giornata di lavoro.</div>
          )}

          <div className="rap-list">
            {data.rapportini.map((r) => (
              <RapportinoDay
                key={r.id}
                interventoId={data.id}
                rapportino={r}
                machine={data.machine}
                machineBase={machineBase}
                photos={data.photos}
                oreByDay={oreByDay}
                currentUserName={currentUserName}
                canSign={canSign}
                defaultOpen={!r.closed}
                onDone={() => router.refresh()}
              />
            ))}
          </div>
        </section>
      </div>

      {/* Check list di cantiere (Ambiente + Sicurezza) */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>Check list di cantiere</h3>
          <span className="muted small">
            {campo ? "PDF firmati" : "Compilate dal responsabile di cantiere"}
          </span>
        </div>
        <div className="checklist-tiles">
          {CHECKLIST_TYPES.map((t) => {
            const def = CHECKLIST_DEFS[t];
            const st = data.checklists.find((c) => c.type === t) ?? null;
            const prog = checklistProgress(def, st?.answers);
            return (
              <div key={t} className="checklist-tile">
                <div className="checklist-tile-head">
                  <div>
                    <div className="checklist-tile-title">{def.title}</div>
                    {st?.closed ? (
                      <span className="status-chip" style={{ background: "#10b98122", color: "#0a7d52" }}>
                        <Icon name="check" size={11} /> Chiusa
                        {st.compiledAt ? ` · ${new Date(st.compiledAt).toLocaleDateString("it-IT")}` : ""}
                      </span>
                    ) : (
                      <span className="status-chip" style={{ background: "#f59e0b22", color: "#b45309" }}>
                        {prog.done > 0 ? `In compilazione ${prog.done}/${prog.total}` : "Da compilare"}
                      </span>
                    )}
                    {st && st.revisionsCount > 0 && (
                      <span className="muted small" style={{ marginLeft: 6 }}>
                        · {st.revisionsCount} correzioni
                      </span>
                    )}
                  </div>
                  <Icon name={def.type === "AMBIENTE" ? "drop" : "flag"} size={22} color="var(--muted)" />
                </div>
                <div className="checklist-tile-actions">
                  {st?.closed && st.pdfPath && (
                    <a className="btn-ghost-sm" href={st.pdfPath} target="_blank" rel="noreferrer">
                      <Icon name="download" size={13} /> Scarica PDF
                    </a>
                  )}
                  {!campo && canChecklist && !st?.closed && (
                    <button className="btn-primary-sm" onClick={() => setChecklistOpen(t)}>
                      <Icon name="doc" size={13} /> Compila
                    </button>
                  )}
                  {!campo && canChecklist && st?.closed && (
                    <button className="btn-ghost-sm" onClick={() => setChecklistOpen(t)}>
                      <Icon name="sign" size={13} /> Correggi
                    </button>
                  )}
                  {campo && !st?.closed && <span className="muted small">Non ancora disponibile</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {checklistOpen && (
        <ChecklistModal
          interventoId={data.id}
          def={CHECKLIST_DEFS[checklistOpen]}
          state={data.checklists.find((c) => c.type === checklistOpen) ?? null}
          onClose={() => setChecklistOpen(null)}
          onDone={() => {
            setChecklistOpen(null);
            router.refresh();
          }}
        />
      )}

      {adding && (
        <div className="modal-backdrop" onClick={() => setAdding(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nuova giornata</h2>
              <button className="icon-btn" onClick={() => setAdding(false)} aria-label="Chiudi">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <RapportinoDay
                interventoId={data.id}
                rapportino={null}
                machine={data.machine}
                machineBase={machineBase}
                photos={[]}
                oreByDay={oreByDay}
                currentUserName={currentUserName}
                canSign={canSign}
                defaultOpen
                hideHeader
                onDone={() => {
                  setAdding(false);
                  router.refresh();
                }}
                onCancel={() => setAdding(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ISO → valore per <input type="datetime-local"> in ora locale. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="readout">{children}</div>
    </div>
  );
}

/* ── Rapportino di una giornata (editor / sola lettura / modifica firmato) ── */
function RapportinoDay({
  interventoId,
  rapportino,
  machine,
  machineBase = "/macchine",
  photos,
  oreByDay,
  currentUserName,
  canSign,
  defaultOpen,
  hideHeader = false,
  onDone,
  onCancel,
}: {
  interventoId: string;
  rapportino: Rapportino | null;
  machine: { code: string; job: string } | null;
  machineBase?: string;
  photos: { id: string; path: string; caption: string | null }[];
  oreByDay: Record<string, number>;
  currentUserName: string;
  canSign: boolean;
  defaultOpen: boolean;
  hideHeader?: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const closed = rapportino?.closed ?? false;
  const [open, setOpen] = useState(defaultOpen);
  const bodyOpen = hideHeader || open;
  const [editing, setEditing] = useState(false); // modifica di un rapportino già firmato
  const readOnly = closed && !editing;

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(rapportino ? rapportino.date.slice(0, 10) : today);
  const [workDescription, setWorkDescription] = useState(rapportino?.workDescription ?? "");
  const [ricambi, setRicambi] = useState<Ricambio[]>(
    rapportino?.ricambi?.length ? rapportino.ricambi : [{ code: "", desc: "", qty: "", note: "" }]
  );
  const [hours, setHours] = useState(rapportino?.hoursWorked != null ? String(rapportino.hoursWorked) : "");
  const [techName, setTechName] = useState(rapportino?.techName ?? currentUserName);
  const [clientName, setClientName] = useState(rapportino?.clientName ?? "");
  const [editNote, setEditNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const techSig = useRef<SignaturePadHandle>(null);
  const clientSig = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState<"draft" | "close" | "edit" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ore timbrate su questo giorno (dalla commessa dell'intervento)
  const oreGiorno = oreByDay[date];
  // prefill automatico se il campo è vuoto e il timbratore ha ore per il giorno
  useEffect(() => {
    if (!readOnly && (hours === "" || hours == null) && oreGiorno != null) setHours(String(oreGiorno));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oreGiorno, date, readOnly]);

  const setRic = (i: number, k: keyof Ricambio, v: string) =>
    setRicambi((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRic = () => setRicambi((rs) => [...rs, { code: "", desc: "", qty: "", note: "" }]);
  const delRic = (i: number) => setRicambi((rs) => rs.filter((_, idx) => idx !== i));

  async function save(kind: "draft" | "close" | "edit") {
    setErr(null);
    const fd = new FormData();
    if (rapportino) fd.set("rapportinoId", rapportino.id);
    fd.set("date", date);
    fd.set("workDescription", workDescription);
    fd.set("ricambi", JSON.stringify(ricambi.filter((r) => r.code.trim() || r.desc.trim())));
    fd.set("hoursWorked", hours);
    fd.set("techName", techName);
    fd.set("clientName", clientName);
    if (techSig.current && !techSig.current.isEmpty()) fd.set("techSignature", techSig.current.toDataURL() ?? "");
    if (clientSig.current && !clientSig.current.isEmpty()) fd.set("clientSignature", clientSig.current.toDataURL() ?? "");
    for (const f of files) fd.append("photos", f);
    if (kind === "close") fd.set("finalize", "1");
    if (kind === "edit") fd.set("editNote", editNote);

    setBusy(kind);
    try {
      const res = await fetch(`/api/interventi/${interventoId}/rapportino`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel salvataggio.");
        return;
      }
      setFiles([]);
      setEditing(false);
      onDone();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!rapportino || !confirm("Eliminare questo rapportino?")) return;
    await fetch(`/api/interventi/${interventoId}/rapportino?rapportinoId=${rapportino.id}`, { method: "DELETE" });
    onDone();
  }

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const revisions = rapportino?.revisions ?? [];

  return (
    <div className={"rap-day" + (hideHeader ? " bare" : "")}>
      {!hideHeader && (
        <button className="rap-day-head" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "chev-down" : "chev-right"} size={14} />
          <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{dateLabel}</span>
          {closed ? (
            <span className="status-chip" style={{ background: "#10b98122", color: "#0a7d52" }}>
              <Icon name="check" size={11} /> Chiuso
            </span>
          ) : (
            <span className="status-chip" style={{ background: "#f59e0b22", color: "#b45309" }}>
              Bozza
            </span>
          )}
          {editing && (
            <span className="status-chip" style={{ background: "#2f6aed22", color: "#2f6aed" }}>
              In modifica
            </span>
          )}
          {rapportino?.hoursWorked != null && <span className="muted small mono">{rapportino.hoursWorked} h</span>}
          {revisions.length > 0 && <span className="muted small">· {revisions.length} modifiche</span>}
          <span style={{ flex: 1 }} />
        </button>
      )}

      {bodyOpen && (
        <div className="rap-day-body">
          {closed && rapportino?.diaryEventId && machine && (
            <div className="info-banner">
              <Icon name="check" size={15} />
              Registrato nel diario del fascicolo{" "}
              <Link href={`${machineBase}/${machine.code}`} className="link-strong">
                {machine.job || machine.code}
              </Link>{" "}
              come evento di manutenzione.
            </div>
          )}

          {!readOnly && (
            <div className="sig-row">
              <div className="field">
                <span className="field-label">Data giornata</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <span className="field-label">Ore lavorate</span>
                <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="es. 2.5" />
                {oreGiorno != null && (
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    style={{ marginTop: 6 }}
                    onClick={() => setHours(String(oreGiorno))}
                    title="Ore timbrate su questa commessa in questo giorno"
                  >
                    <Icon name="clock" size={12} /> Timbratore: {oreGiorno} h
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <span className="field-label">Attività eseguita</span>
            <textarea
              rows={3}
              value={workDescription}
              disabled={readOnly}
              onChange={(e) => setWorkDescription(e.target.value)}
              placeholder="Descrivi l'intervento della giornata…"
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
                  {!readOnly && <th style={{ width: 34 }}></th>}
                </tr>
              </thead>
              <tbody>
                {ricambi.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {readOnly ? (
                        <input value={r.code} disabled />
                      ) : (
                        <ArticleInput
                          value={r.code}
                          onPick={(code, desc) => {
                            setRic(i, "code", code);
                            if (desc !== undefined) setRic(i, "desc", desc);
                          }}
                        />
                      )}
                    </td>
                    <td>
                      <input value={r.desc} disabled={readOnly} onChange={(e) => setRic(i, "desc", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.qty} disabled={readOnly} onChange={(e) => setRic(i, "qty", e.target.value)} />
                    </td>
                    <td>
                      <input value={r.note} disabled={readOnly} onChange={(e) => setRic(i, "note", e.target.value)} />
                    </td>
                    {!readOnly && (
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
            {!readOnly && (
              <button className="btn-ghost-sm" onClick={addRic} style={{ marginTop: 8 }}>
                <Icon name="plus" size={13} /> Aggiungi ricambio
              </button>
            )}
          </div>

          {photos.length > 0 && (
            <div className="field">
              <span className="field-label">Foto cantiere</span>
              <div className="photo-grid-sm">
                {photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={p.id} href={p.path} target="_blank" rel="noreferrer">
                    <img src={p.path} alt={p.caption ?? ""} />
                  </a>
                ))}
              </div>
            </div>
          )}
          {!readOnly && (
            <div className="field">
              <span className="field-label">Aggiungi foto</span>
              <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              {files.length > 0 && <div className="muted small">{files.length} foto da caricare</div>}
            </div>
          )}

          <div className="sig-row">
            <div className="field">
              <span className="field-label">Firma tecnico</span>
              {readOnly && rapportino?.techSignature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sig-readout" src={rapportino.techSignature} alt="firma tecnico" />
              ) : (
                <>
                  <SignaturePad ref={techSig} height={110} />
                  <button className="btn-ghost-sm" onClick={() => techSig.current?.clear()} type="button">
                    Pulisci
                  </button>
                  {editing && (
                    <div className="muted small">Lascia vuoto per mantenere la firma attuale.</div>
                  )}
                </>
              )}
              <input
                value={techName}
                disabled={readOnly}
                onChange={(e) => setTechName(e.target.value)}
                placeholder="Nome tecnico"
                style={{ marginTop: 6 }}
              />
            </div>
            <div className="field">
              <span className="field-label">Firma cliente</span>
              {readOnly && rapportino?.clientSignature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sig-readout" src={rapportino.clientSignature} alt="firma cliente" />
              ) : (
                <>
                  <SignaturePad ref={clientSig} height={110} />
                  <button className="btn-ghost-sm" onClick={() => clientSig.current?.clear()} type="button">
                    Pulisci
                  </button>
                </>
              )}
              <input
                value={clientName}
                disabled={readOnly}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nome cliente"
                style={{ marginTop: 6 }}
              />
            </div>
          </div>

          {editing && (
            <div className="field">
              <span className="field-label">Motivo della modifica (log)</span>
              <input
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="es. correzione ore / ricambio aggiunto…"
              />
            </div>
          )}

          {closed && rapportino?.hash && (
            <div className="muted small mono">SHA256 · {rapportino.hash.slice(0, 16)}…</div>
          )}
          {err && <div className="form-error">{err}</div>}

          {/* Cronologia modifiche del rapportino firmato */}
          {revisions.length > 0 && (
            <div className="field">
              <button className="btn-ghost-sm" onClick={() => setShowHistory((s) => !s)}>
                <Icon name={showHistory ? "chev-down" : "chev-right"} size={12} /> Cronologia modifiche (
                {revisions.length})
              </button>
              {showHistory && (
                <ul className="rev-list">
                  {revisions.map((rev) => (
                    <li key={rev.id}>
                      <div className="rev-head">
                        <strong>{rev.editedByName}</strong>
                        <span className="muted small">{new Date(rev.editedAt).toLocaleString("it-IT")}</span>
                      </div>
                      {rev.note && <div className="small">{rev.note}</div>}
                      <div className="muted small">
                        Valori precedenti: {rev.snapshot?.hoursWorked ?? "—"} h ·{" "}
                        {rev.snapshot?.workDescription ? `"${rev.snapshot.workDescription.slice(0, 60)}"` : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Azioni */}
          {canSign && (
            <div className="rapportino-actions">
              {readOnly ? (
                <button className="btn-ghost" onClick={() => setEditing(true)}>
                  <Icon name="sign" size={14} /> Modifica
                </button>
              ) : editing ? (
                <>
                  <button
                    className="btn-ghost"
                    onClick={() => setEditing(false)}
                    disabled={busy !== null}
                    style={{ marginRight: "auto" }}
                  >
                    Annulla
                  </button>
                  <button className="btn-primary" onClick={() => save("edit")} disabled={busy !== null}>
                    <Icon name="check" size={15} />
                    {busy === "edit" ? "Salvataggio…" : "Salva modifica"}
                  </button>
                </>
              ) : (
                <>
                  {rapportino ? (
                    <button
                      className="btn-ghost"
                      onClick={remove}
                      disabled={busy !== null}
                      style={{ marginRight: "auto" }}
                    >
                      <Icon name="trash" size={14} /> Elimina
                    </button>
                  ) : (
                    onCancel && (
                      <button
                        className="btn-ghost"
                        onClick={onCancel}
                        disabled={busy !== null}
                        style={{ marginRight: "auto" }}
                      >
                        Annulla
                      </button>
                    )
                  )}
                  <button className="btn-ghost" onClick={() => save("draft")} disabled={busy !== null}>
                    {busy === "draft" ? "Salvataggio…" : "Salva bozza"}
                  </button>
                  <button className="btn-primary" onClick={() => save("close")} disabled={busy !== null}>
                    <Icon name="check" size={15} />
                    {busy === "close" ? "Chiusura…" : "Firma e chiudi giornata"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Modale compilazione check list di cantiere ── */
function ChecklistModal({
  interventoId,
  def,
  state,
  onClose,
  onDone,
}: {
  interventoId: string;
  def: ChecklistDef;
  state: ChecklistState | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const correcting = state?.closed === true;
  const [answers, setAnswers] = useState<Record<string, string>>(state?.answers ?? {});
  const [fields, setFields] = useState<Record<string, string>>(state?.fields ?? {});
  const [clientName, setClientName] = useState(state?.clientName ?? "");
  const [editNote, setEditNote] = useState("");
  const respSig = useRef<SignaturePadHandle>(null);
  const clientSig = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState<"draft" | "close" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const setAns = (k: string, v: string) => setAnswers((s) => ({ ...s, [k]: s[k] === v ? "" : v }));
  const setField = (k: string, v: string) => setFields((s) => ({ ...s, [k]: v }));

  async function save(finalize: boolean) {
    setErr(null);
    const body: Record<string, unknown> = {
      type: def.type,
      answers,
      fields,
      clientName,
      finalize,
    };
    if (correcting) body.editNote = editNote;
    if (respSig.current && !respSig.current.isEmpty()) body.compilerSignature = respSig.current.toDataURL();
    if (clientSig.current && !clientSig.current.isEmpty()) body.clientSignature = clientSig.current.toDataURL();

    setBusy(finalize ? "close" : "draft");
    try {
      const res = await fetch(`/api/interventi/${interventoId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore nel salvataggio.");
        return;
      }
      onDone();
    } finally {
      setBusy(null);
    }
  }

  const OPTS: { v: string; label: string; color: string }[] = [
    { v: "SI", label: "SÌ", color: "#0a7d52" },
    { v: "NO", label: "NO", color: "#b91c1c" },
    { v: "NA", label: "N.A.", color: "#b45309" },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{def.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          {correcting && (
            <div className="info-banner" style={{ background: "#fef9c3", color: "#854d0e" }}>
              <Icon name="sign" size={15} />
              Stai correggendo una check list già firmata. Salvando con la firma verrà
              rigenerato un nuovo PDF e la correzione registrata nello storico.
            </div>
          )}
          {def.intro && <div className="info-banner">{def.intro}</div>}

          {correcting && (
            <label className="field">
              <span className="field-label">Motivo della correzione</span>
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="es. errore su voce DPI / data errata…" />
            </label>
          )}

          {def.headerFields.map((hf) => (
            <label key={hf.key} className="field">
              <span className="field-label">{hf.label}</span>
              <input value={fields[hf.key] ?? ""} onChange={(e) => setField(hf.key, e.target.value)} />
            </label>
          ))}

          {def.sections.map((sec) => (
            <div key={sec.title} className="field">
              <span className="field-label">{sec.title}</span>
              {sec.intro && <div className="muted small" style={{ marginBottom: 4 }}>{sec.intro}</div>}
              <div className="chk-items">
                {sec.items.map((it) => (
                  <div key={it.key} className="chk-item">
                    <span className="chk-item-label">{it.label}</span>
                    <div className="chk-opts">
                      {OPTS.map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          className={"chk-opt" + (answers[it.key] === o.v ? " on" : "")}
                          style={answers[it.key] === o.v ? { background: o.color + "22", color: o.color, borderColor: o.color } : undefined}
                          onClick={() => setAns(it.key, o.v)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {def.notes.map((n) => (
            <label key={n.key} className="field">
              <span className="field-label">{n.label}</span>
              <textarea rows={2} value={fields[n.key] ?? ""} onChange={(e) => setField(n.key, e.target.value)} />
            </label>
          ))}

          <div className="sig-row">
            <div className="field">
              <span className="field-label">
                {def.type === "SICUREZZA" ? "Firma Preposto / Responsabile" : "Firma operatore ZATO"}
              </span>
              <SignaturePad ref={respSig} height={110} />
              <button className="btn-ghost-sm" type="button" onClick={() => respSig.current?.clear()}>
                Pulisci
              </button>
              {correcting && <div className="muted small">Lascia vuoto per mantenere la firma attuale.</div>}
            </div>
            {def.clientSignature && (
              <div className="field">
                <span className="field-label">Firma Cliente</span>
                <SignaturePad ref={clientSig} height={110} />
                <button className="btn-ghost-sm" type="button" onClick={() => clientSig.current?.clear()}>
                  Pulisci
                </button>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nome cliente"
                  style={{ marginTop: 6 }}
                />
              </div>
            )}
          </div>
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={() => save(false)} disabled={busy !== null}>
            {busy === "draft" ? "Salvataggio…" : "Salva bozza"}
          </button>
          <button className="btn-primary" onClick={() => save(true)} disabled={busy !== null}>
            <Icon name="check" size={15} />
            {busy === "close"
              ? "Generazione PDF…"
              : correcting
              ? "Aggiorna e ristampa PDF"
              : "Firma e chiudi (genera PDF)"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Autocomplete articoli/ricambi dal gestionale ── */
function ArticleInput({
  value,
  onPick,
}: {
  value: string;
  onPick: (code: string, desc?: string) => void;
}) {
  const [q, setQ] = useState(value);
  const [sugg, setSugg] = useState<{ code: string; description: string }[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setQ(value), [value]);

  function onChange(v: string) {
    setQ(v);
    onPick(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setSugg([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/erp/articles?q=${encodeURIComponent(v)}`);
        const d = await res.json().catch(() => null);
        if (res.ok && Array.isArray(d.articles)) {
          setSugg(d.articles);
          setOpen(d.articles.length > 0);
        }
      } catch {
        /* rete */
      }
    }, 300);
  }

  return (
    <div className="art-input">
      <input
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => sugg.length > 0 && setOpen(true)}
        placeholder="cod. / descr."
      />
      {open && (
        <div className="art-sugg">
          {sugg.map((a) => (
            <button
              key={a.code}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(a.code, a.description);
                setQ(a.code);
                setOpen(false);
              }}
            >
              <span className="mono">{a.code}</span>
              <span className="muted small">{a.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
