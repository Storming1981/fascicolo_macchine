"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { Flag } from "@/components/Icon";
import { SignaturePad, SignaturePadHandle } from "@/components/SignaturePad";
import { COMPONENT_GROUPS } from "@/lib/components";
import {
  STATUS_META,
  PHASE_META,
  STATUS_ORDER,
  INTERVENTO_STATUS_META,
  PRIORITY_META,
} from "@/lib/domain";
import { MILESTONES, milestoneDef } from "@/lib/milestones";
import { CHECKLIST_TRITURATORE } from "@/lib/checklist";
import { fmtDate, fmtBytes } from "@/lib/format";
import type { MachineStatus, InterventoStatus } from "@prisma/client";

type ServiceData = {
  interventi: { id: string; code: string; title: string; status: InterventoStatus; priority: number }[];
  chats: { id: string; title: string; channel: string; contactName: string | null; messages: number }[];
};

type Item = { id: string; position: number; label: string; serial: string | null; note: string | null };
type Comp = { id: string; groupId: string; brand: string | null; extra: Record<string, string> | null; items: Item[] };
type Diary = {
  id: string; phase: string; type: string; title: string; note: string | null;
  date: string; actorName: string; oldSerial: string | null; newSerial: string | null;
  signed: boolean; photos: { id: string; path: string; caption: string | null }[];
};
type Machine = {
  id: string; code: string; job: string; jobBody: string | null; jobContainer: string | null;
  erpBodyOrder: string | null; erpContainerOrder: string | null;
  erpStandOrder: string | null; erpBladesOrder: string | null;
  erpDescription: string | null; erpHours: number | null; erpSyncedAt: string | null;
  plantType: string | null;
  model: string; year: number; customer: string; customerId: string | null; country: string; countryCode: string;
  site: string | null; status: MachineStatus; progress: number;
  productionStart: string | null; deliveryDate: string | null; pressureSettings: string | null;
  plateWeight: string | null; platePower: string | null; plateVoltage: string | null; notes: string | null;
  components: Comp[];
  diary: Diary[];
  photos: { id: string; path: string; category: string; caption: string | null; authorName: string | null; takenAt: string }[];
  documents: { id: string; name: string; path: string; sizeBytes: number; category: string }[];
  signatures: { id: string; role: string; signerName: string; method: string; imageData: string | null; signedAt: string }[];
  milestones: { key: string; date: string; source: string }[];
  collaudo: {
    status: "DRAFT" | "IN_PROGRESS" | "PENDING_APPROVAL" | "APPROVED";
    answers: Record<string, { value: string | null; note?: string }>;
    compilerName: string | null;
    compiledAt: string | null;
    compilerSignature: string | null;
    approverName: string | null;
    approvedAt: string | null;
    approverSignature: string | null;
    approverRemarks: string | null;
    compilerId: string | null;
  } | null;
};

const TABS = [
  { id: "anagrafica", label: "Anagrafica", icon: "doc" },
  { id: "componenti", label: "Componenti & Matricole", icon: "gear" },
  { id: "foto", label: "Foto produzione", icon: "image" },
  { id: "collaudo", label: "Collaudo & Firme", icon: "sign" },
  { id: "diario", label: "Diario macchina", icon: "clock" },
  { id: "service", label: "Service", icon: "wrench" },
  { id: "qr", label: "QR & Etichetta", icon: "qr" },
];

export default function MachineDetail({
  machine,
  qrDataUrl,
  service,
  currentUser,
  caps,
}: {
  machine: Machine;
  qrDataUrl: string;
  service: ServiceData;
  currentUser: { id: string; name: string; role: string; hasPin: boolean; hasSignature: boolean };
  caps: {
    edit: boolean;
    intervention: boolean;
    sign: boolean;
    service: boolean;
    interventoCreate: boolean;
    chatSend: boolean;
  };
}) {
  const router = useRouter();
  const tabs = TABS.filter((t) => t.id !== "service" || caps.service);
  const [tab, setTab] = useState("anagrafica");
  const [intervention, setIntervention] = useState<null | { groupId?: string; itemId?: string; itemLabel?: string; oldSerial?: string }>(null);
  const [signRole, setSignRole] = useState<string | null>(null);
  const [collaudoOpen, setCollaudoOpen] = useState<null | "compile" | "approve" | "view">(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const meta = STATUS_META[machine.status];
  const notify = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };
  const refresh = () => router.refresh();

  return (
    <div className="view">
      <header className="detail-header">
        <div className="detail-id-block">
          <div className="detail-tag mono">FASCICOLO TECNICO</div>
          <h1 className="detail-id mono">{machine.code}</h1>
          <div className="detail-meta">
            {machine.plantType && (
              <>
                <span
                  className="phase-chip"
                  style={{ background: "var(--accent-soft)", color: "var(--navy)" }}
                >
                  {machine.plantType}
                </span>
                <span className="dot-sep">·</span>
              </>
            )}
            <span>{machine.model}</span>
            <span className="dot-sep">·</span>
            <span>Job <span className="mono">{machine.job}</span></span>
            <span className="dot-sep">·</span>
            <Flag code={machine.countryCode} />
            <span>{machine.customer} — {machine.country}</span>
          </div>
        </div>
        <div className="detail-status-block">
          {caps.edit ? (
            <StatusControl machine={machine} onDone={refresh} notify={notify} />
          ) : (
            <>
              <span className="badge">
                <span className="badge-dot" style={{ background: meta.color }} />
                {meta.label}
              </span>
              <div className="detail-progress">
                <span className="mono small muted">Avanzamento {machine.progress}%</span>
                <div className="detail-progress-bar">
                  <span style={{ width: machine.progress + "%", background: meta.color }} />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="detail-actions">
          <button className="btn-ghost" onClick={() => window.print()}>
            <Icon name="download" size={15} /> Stampa fascicolo
          </button>
          {caps.intervention && (
            <button className="btn-primary" onClick={() => setIntervention({})}>
              <Icon name="plus" size={15} /> Nuovo intervento
            </button>
          )}
        </div>
      </header>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "anagrafica" && (
        <TabAnagrafica machine={machine} canEdit={caps.edit} onDone={refresh} notify={notify} />
      )}
      {tab === "componenti" && (
        <TabComponenti
          machine={machine}
          onReplace={caps.intervention ? (c) => setIntervention(c) : undefined}
          onDone={refresh}
          notify={notify}
        />
      )}
      {tab === "foto" && <TabFoto machine={machine} onDone={refresh} notify={notify} />}
      {tab === "collaudo" && (
        <TabCollaudo
          machine={machine}
          onSign={caps.sign ? (r) => setSignRole(r) : undefined}
          currentUserId={currentUser.id}
          canCompile={caps.intervention}
          canApprove={caps.sign}
          onOpenChecklist={(m) => setCollaudoOpen(m)}
        />
      )}
      {tab === "diario" && (
        <TabDiario
          machine={machine}
          onIntervention={caps.intervention ? () => setIntervention({}) : undefined}
        />
      )}
      {tab === "service" && caps.service && (
        <TabService machine={machine} service={service} caps={caps} notify={notify} />
      )}
      {tab === "qr" && <TabQR machine={machine} qrDataUrl={qrDataUrl} />}

      {intervention && (
        <InterventionModal
          machine={machine}
          prefill={intervention}
          currentUser={currentUser}
          onClose={() => setIntervention(null)}
          onSaved={() => {
            setIntervention(null);
            refresh();
            notify("Intervento registrato nel diario");
          }}
          onError={(m) => notify(m, "err")}
        />
      )}
      {signRole && (
        <SignModal
          machine={machine}
          role={signRole}
          currentUser={currentUser}
          onClose={() => setSignRole(null)}
          onSaved={() => {
            setSignRole(null);
            refresh();
            notify("Firma registrata");
          }}
          onError={(m) => notify(m, "err")}
        />
      )}
      {collaudoOpen && (
        <CollaudoModal
          machine={machine}
          mode={collaudoOpen}
          currentUser={currentUser}
          onClose={() => setCollaudoOpen(null)}
          onSaved={(msg) => {
            setCollaudoOpen(null);
            refresh();
            notify(msg);
          }}
          onError={(m) => notify(m, "err")}
        />
      )}

      {toast && (
        <div className="toast-wrap">
          <div className={"toast " + toast.kind}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}

/* ── Status control ─────────────────────────────────────── */
function StatusControl({
  machine,
  onDone,
  notify,
}: {
  machine: Machine;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[machine.status];

  async function update(patch: { status?: string; progress?: number }) {
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (res.ok) {
      onDone();
      notify("Stato aggiornato");
    } else notify("Errore aggiornamento stato", "err");
  }

  return (
    <>
      <select
        className="input"
        style={{ maxWidth: 190 }}
        value={machine.status}
        disabled={busy}
        onChange={(e) => update({ status: e.target.value })}
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
      <div className="detail-progress">
        <span className="mono small muted">Avanzamento {machine.progress}%</span>
        <div className="detail-progress-bar">
          <span style={{ width: machine.progress + "%", background: meta.color }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          defaultValue={machine.progress}
          disabled={busy}
          onMouseUp={(e) => update({ progress: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => update({ progress: Number((e.target as HTMLInputElement).value) })}
          style={{ width: 190 }}
        />
      </div>
    </>
  );
}

/* ── Tab Anagrafica ─────────────────────────────────────── */
function TabAnagrafica({
  machine,
  canEdit,
  onDone,
  notify,
}: {
  machine: Machine;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const docRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isoToDay = (iso?: string) => (iso ? iso.slice(0, 10) : "");
  const msInit = () => {
    const m: Record<string, string> = {};
    for (const def of MILESTONES) {
      const found = machine.milestones.find((x) => x.key === def.key);
      m[def.key] = found ? isoToDay(found.date) : "";
    }
    return m;
  };
  const [editMs, setEditMs] = useState(false);
  const [ms, setMs] = useState<Record<string, string>>(msInit());

  async function saveMilestones() {
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: MILESTONES.map((d) => ({ key: d.key, date: ms[d.key] || "" })),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setEditMs(false);
      onDone();
      notify("Date di stato aggiornate");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore salvataggio date", "err");
    }
  }

  const [editJobs, setEditJobs] = useState(false);
  const [jobs, setJobs] = useState({
    job: machine.job,
    jobBody: machine.jobBody || "",
    jobContainer: machine.jobContainer || "",
  });

  async function saveJobs() {
    if (!jobs.job.trim()) return notify("Il Job Number è obbligatorio", "err");
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: jobs.job,
        jobBody: jobs.jobBody,
        jobContainer: jobs.jobContainer,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setEditJobs(false);
      onDone();
      notify("Job aggiornati");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore salvataggio", "err");
    }
  }

  async function uploadDocs(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const res = await fetch(`/api/machines/${machine.id}/documents`, { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) {
      onDone();
      notify("Documenti caricati");
    } else notify("Errore upload documenti", "err");
  }

  return (
    <div className="tab-content">
      <div className="grid-two">
        <section className="card">
          <div className="card-header">
            <h3>Anagrafica macchina</h3>
            {canEdit &&
              (editJobs ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn-ghost-sm"
                    onClick={() => {
                      setEditJobs(false);
                      setJobs({
                        job: machine.job,
                        jobBody: machine.jobBody || "",
                        jobContainer: machine.jobContainer || "",
                      });
                    }}
                  >
                    Annulla
                  </button>
                  <button className="btn-primary-sm" disabled={busy} onClick={saveJobs}>
                    <Icon name="check" size={13} /> Salva
                  </button>
                </div>
              ) : (
                <button className="btn-ghost-sm" onClick={() => setEditJobs(true)}>
                  <Icon name="wrench" size={13} /> Modifica job
                </button>
              ))}
          </div>
          <dl className="kv">
            <div><dt>ID Fascicolo</dt><dd className="mono">{machine.code}</dd></div>
            <div><dt>Tipologia impianto</dt><dd>{machine.plantType || "—"}</dd></div>
            <div><dt>Modello</dt><dd>{machine.model}</dd></div>
            <div>
              <dt>Job Number (commessa di vendita)</dt>
              <dd className="mono">
                {editJobs ? (
                  <input
                    className="input mono"
                    value={jobs.job}
                    onChange={(e) => setJobs((s) => ({ ...s, job: e.target.value }))}
                  />
                ) : (
                  machine.job
                )}
              </dd>
            </div>
            <div>
              <dt>Job Body (corpo trituratore)</dt>
              <dd className="mono">
                {editJobs ? (
                  <input
                    className="input mono"
                    value={jobs.jobBody}
                    placeholder="—"
                    onChange={(e) => setJobs((s) => ({ ...s, jobBody: e.target.value }))}
                  />
                ) : (
                  machine.jobBody || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Job Container (container)</dt>
              <dd className="mono">
                {editJobs ? (
                  <input
                    className="input mono"
                    value={jobs.jobContainer}
                    placeholder="—"
                    onChange={(e) => setJobs((s) => ({ ...s, jobContainer: e.target.value }))}
                  />
                ) : (
                  machine.jobContainer || "—"
                )}
              </dd>
            </div>
            <div><dt>Anno</dt><dd>{machine.year}</dd></div>
          </dl>
        </section>
        <section className="card">
          <div className="card-header"><h3>Cliente e destinazione</h3></div>
          <dl className="kv">
            <div><dt>Cliente</dt><dd>{machine.customer}</dd></div>
            <div><dt>Paese</dt><dd>{machine.country}</dd></div>
            <div><dt>Sito</dt><dd>{machine.site || "—"}</dd></div>
            <div><dt>Inizio produzione</dt><dd>{fmtDate(machine.productionStart)}</dd></div>
            <div><dt>Data consegna</dt><dd>{fmtDate(machine.deliveryDate)}</dd></div>
          </dl>
        </section>

        <ErpCard machine={machine} canEdit={canEdit} onDone={onDone} notify={notify} />

        <section className="card">
          <div className="card-header"><h3>Targa tecnica</h3></div>
          <dl className="kv">
            <div><dt>Peso</dt><dd>{machine.plateWeight || "—"}</dd></div>
            <div><dt>Potenza nominale</dt><dd>{machine.platePower || "—"}</dd></div>
            <div><dt>Tensione / Frequenza</dt><dd>{machine.plateVoltage || "—"}</dd></div>
            <div><dt>Settaggi pressione</dt><dd className="mono">{machine.pressureSettings || "—"}</dd></div>
          </dl>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Date di stato (diario)</h3>
            {canEdit &&
              (editMs ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn-ghost-sm"
                    onClick={() => {
                      setEditMs(false);
                      setMs(msInit());
                    }}
                  >
                    Annulla
                  </button>
                  <button className="btn-primary-sm" disabled={busy} onClick={saveMilestones}>
                    <Icon name="check" size={13} /> Salva
                  </button>
                </div>
              ) : (
                <button className="btn-ghost-sm" onClick={() => setEditMs(true)}>
                  <Icon name="wrench" size={13} /> Modifica date
                </button>
              ))}
          </div>
          <dl className="kv">
            {MILESTONES.map((d) => (
              <div key={d.key}>
                <dt>
                  {d.label}
                  <div className="muted small" style={{ fontWeight: 400 }}>
                    {d.hint}
                  </div>
                </dt>
                <dd>
                  {editMs ? (
                    <input
                      className="input"
                      type="date"
                      value={ms[d.key] || ""}
                      onChange={(e) => setMs((s) => ({ ...s, [d.key]: e.target.value }))}
                    />
                  ) : ms[d.key] ? (
                    <span className="mono">{fmtDate(ms[d.key])}</span>
                  ) : (
                    <span className="muted">— da definire</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="muted small" style={{ marginTop: 10 }}>
            Inserimento manuale. In seguito alimentate dal gestionale (timbrature,
            ordini di produzione, DDT).
          </p>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Documenti allegati</h3>
            <button
              className="btn-ghost-sm"
              disabled={busy}
              onClick={() => docRef.current?.click()}
            >
              <Icon name="plus" size={14} /> Carica
            </button>
            <input
              ref={docRef}
              type="file"
              multiple
              hidden
              onChange={(e) => uploadDocs(e.target.files)}
            />
          </div>
          {machine.documents.length === 0 && (
            <p className="muted small">Nessun documento. Carica schemi, manuali, dichiarazione CE…</p>
          )}
          <ul className="doc-list">
            {machine.documents.map((d) => (
              <li key={d.id}>
                <Icon name="doc" size={16} />
                <a className="fname" href={d.path} target="_blank" rel="noreferrer">
                  {d.name}
                </a>
                <span className="muted mono small">{fmtBytes(d.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ── Card Dati gestionale (ERP / SQL Server ZATO) ───────── */
type ErpJob = {
  job: string;
  found: boolean;
  description: string | null;
  customer: string | null;
  customerCountryIso: string | null;
  openedAt: string | null;
  closedAt: string | null;
  isClosed: boolean;
  productionStart: string | null;
  productionEnd: string | null;
  progressRows: number;
  hours: number;
};
type ErpOrderArticle = {
  code: string | null;
  desc: string | null;
  hours: number;
  rows: number;
  start: string | null;
  end: string | null;
};
type ErpOrderData = {
  key: string;
  found: boolean;
  tipork: string;
  anno: number;
  serie: string;
  num: number;
  hours: number;
  start: string | null;
  end: string | null;
  articles: ErpOrderArticle[];
};
type ErpData = {
  jobs: ErpJob[];
  orders: { role: string; data: ErpOrderData }[];
  productionStart: string | null;
  productionEnd: string | null;
  totalHours: number;
  hasProduction: boolean;
};
// Voce della tendina ordini di una commessa
type ErpOrder = {
  key: string;
  tipork: string;
  anno: number;
  serie: string;
  num: number;
  mainArticleCode: string | null;
  mainArticleDesc: string | null;
  hours: number;
  start: string | null;
  end: string | null;
  rows: number;
  articleCount: number;
};

const GENERIC_COMMESSA = "999999999"; // commessa generica impianti nuovi
function isGenericCommessa(v: string | null | undefined): boolean {
  return !!v && String(v).trim() === GENERIC_COMMESSA;
}

function ErpCard({
  machine,
  canEdit,
  onDone,
  notify,
}: {
  machine: Machine;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<ErpData | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [applying, setApplying] = useState(false);

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/machines/${machine.id}/erp-sync`);
      if (res.status === 503) {
        setState("unavailable");
        return;
      }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrMsg(d.error || "Gestionale non raggiungibile");
        setState("error");
        return;
      }
      setData(d);
      setState("ok");
    } catch {
      setErrMsg("Gestionale non raggiungibile");
      setState("error");
    }
  }

  // Si riaggiorna automaticamente quando cambiano i job (anche dopo "Modifica job")
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id, machine.job, machine.jobBody, machine.jobContainer]);

  async function apply() {
    setApplying(true);
    const res = await fetch(`/api/machines/${machine.id}/erp-sync`, { method: "POST" });
    setApplying(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      notify("Date di produzione importate dal gestionale");
      onDone();
    } else {
      notify(d.error || "Errore importazione", "err");
    }
  }

  const jobsList = data?.jobs ?? [];
  const found = jobsList.filter((j) => j.found);
  // Etichetta il ruolo di ciascun job (Vendita / Corpo / Container)
  const roleOf = (job: string): string => {
    const r: string[] = [];
    if (machine.job && job === machine.job) r.push("Vendita");
    if (machine.jobBody && job === machine.jobBody) r.push("Corpo");
    if (machine.jobContainer && job === machine.jobContainer) r.push("Container");
    return r.join(" / ");
  };
  const fmtHours = (h: number) =>
    h > 0 ? `${h.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h` : "—";

  return (
    <section className="card">
      <div className="card-header">
        <h3>Dati gestionale (ERP)</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn-ghost-sm" onClick={load} disabled={state === "loading"}>
            <Icon name="clock" size={13} /> Aggiorna
          </button>
          {canEdit && data?.hasProduction && (
            <button className="btn-primary-sm" disabled={applying} onClick={apply}>
              <Icon name="check" size={13} /> Applica date
            </button>
          )}
        </div>
      </div>

      {state === "loading" && <p className="muted small">Lettura dal gestionale…</p>}

      {state === "unavailable" && (
        <p className="muted small">Integrazione gestionale non configurata.</p>
      )}

      {state === "error" && (
        <p className="muted small" style={{ color: "var(--danger, #b3261e)" }}>
          {errMsg}
        </p>
      )}

      {state === "ok" && data && (
        <>
          {jobsList.length === 0 ? (
            <p className="muted small">
              Nessun job numerico impostato in anagrafica (Job Number / Body / Container).
            </p>
          ) : (
            <>
              <dl className="kv">
                <div>
                  <dt>Inizio produzione (gestionale)</dt>
                  <dd className="mono">
                    {data.productionStart ? (
                      fmtDate(data.productionStart)
                    ) : (
                      <span className="muted">— nessuna timbratura</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Fine produzione (gestionale)</dt>
                  <dd className="mono">
                    {data.productionEnd ? (
                      fmtDate(data.productionEnd)
                    ) : (
                      <span className="muted">— in corso / assente</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Ore di lavorazione totali</dt>
                  <dd className="mono">{fmtHours(data.totalHours)}</dd>
                </div>
              </dl>

              <table className="erp-jobs">
                <thead>
                  <tr>
                    <th>Job / Commessa</th>
                    <th>Ruolo</th>
                    <th>Descrizione</th>
                    <th>Cliente</th>
                    <th>Aperta</th>
                    <th>Timbr.</th>
                    <th>Ore</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsList.map((j) => (
                    <tr key={j.job} style={j.found ? undefined : { opacity: 0.55 }}>
                      <td className="mono">{j.job}</td>
                      <td>{roleOf(j.job) || "—"}</td>
                      <td>
                        {j.found ? (
                          j.description || "—"
                        ) : (
                          <span className="muted">non trovata nel gestionale</span>
                        )}
                      </td>
                      <td>{j.customer || "—"}</td>
                      <td className="mono">{j.openedAt ? fmtDate(j.openedAt) : "—"}</td>
                      <td className="mono">{j.found ? j.progressRows || 0 : "—"}</td>
                      <td className="mono">{j.found ? fmtHours(j.hours) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Ordini di produzione: solo impianti nuovi (Body e Container = 999999999) */}
              {isGenericCommessa(machine.jobBody) &&
                isGenericCommessa(machine.jobContainer) && (
                  <div style={{ marginTop: 14 }}>
                    <div
                      className="muted small"
                      style={{ fontWeight: 600, marginBottom: 6 }}
                    >
                      Ordini di produzione (impianto nuovo, commessa 999999999)
                    </div>
                    <OrderPicker
                      machineId={machine.id}
                      role="Corpo"
                      commessa={GENERIC_COMMESSA}
                      field="erpBodyOrder"
                      currentKey={machine.erpBodyOrder}
                      canEdit={canEdit}
                      onDone={onDone}
                      notify={notify}
                    />
                    <OrderPicker
                      machineId={machine.id}
                      role="Container"
                      commessa={GENERIC_COMMESSA}
                      field="erpContainerOrder"
                      currentKey={machine.erpContainerOrder}
                      canEdit={canEdit}
                      onDone={onDone}
                      notify={notify}
                    />
                    <OrderPicker
                      machineId={machine.id}
                      role="Cavalletto"
                      commessa={GENERIC_COMMESSA}
                      field="erpStandOrder"
                      currentKey={machine.erpStandOrder}
                      canEdit={canEdit}
                      onDone={onDone}
                      notify={notify}
                    />
                    <OrderPicker
                      machineId={machine.id}
                      role="Lame"
                      commessa={GENERIC_COMMESSA}
                      field="erpBladesOrder"
                      currentKey={machine.erpBladesOrder}
                      canEdit={canEdit}
                      onDone={onDone}
                      notify={notify}
                    />
                  </div>
                )}

              {/* Dettaglio articoli degli ordini selezionati */}
              {data.orders.filter((o) => o.data.found).map((o) => (
                <div key={o.role + o.data.key} style={{ marginTop: 12 }}>
                  <div className="muted small" style={{ fontWeight: 600 }}>
                    Articoli ordine {o.role} — {o.data.tipork}/{o.data.anno}/
                    {o.data.num} · {fmtHours(o.data.hours)} ·{" "}
                    {o.data.start ? fmtDate(o.data.start) : "—"} →{" "}
                    {o.data.end ? fmtDate(o.data.end) : "—"}
                  </div>
                  <table className="erp-jobs">
                    <thead>
                      <tr>
                        <th>Articolo</th>
                        <th>Descrizione</th>
                        <th>Timbr.</th>
                        <th>Ore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.data.articles.map((a) => (
                        <tr key={a.code || a.desc || Math.random()}>
                          <td className="mono">{a.code || "—"}</td>
                          <td>{a.desc || "—"}</td>
                          <td className="mono">{a.rows}</td>
                          <td className="mono">{fmtHours(a.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              <p className="muted small" style={{ marginTop: 8 }}>
                Inizio/fine produzione = prima/ultima timbratura, ore = somma tempi
                eseguiti (tabella <span className="mono">avlavp</span>). Per gli impianti
                nuovi seleziona l&apos;ordine: ore/date/articoli vengono dall&apos;ordine,
                non dalla commessa generica. “Applica date” aggiorna le date di stato del
                diario con origine <span className="mono">GESTIONALE</span>.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ── Selettore ordine di produzione di una commessa ─────── */
function OrderPicker({
  machineId,
  role,
  commessa,
  field,
  currentKey,
  canEdit,
  onDone,
  notify,
}: {
  machineId: string;
  role: string;
  commessa: string;
  field: "erpBodyOrder" | "erpContainerOrder" | "erpStandOrder" | "erpBladesOrder";
  currentKey: string | null;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [orders, setOrders] = useState<ErpOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/erp/commessa/${encodeURIComponent(commessa)}/orders`)
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d) => {
        if (alive) setOrders(d.orders ?? []);
      })
      .catch(() => alive && setOrders([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [commessa]);

  async function select(key: string) {
    setSaving(true);
    const res = await fetch(`/api/machines/${machineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: key }),
    });
    setSaving(false);
    if (res.ok) {
      notify(key ? `Ordine ${role} selezionato` : `Ordine ${role} rimosso`);
      onDone();
    } else {
      notify("Errore salvataggio ordine", "err");
    }
  }

  return (
    <div className="erp-order-row">
      <label className="muted small" style={{ minWidth: 90 }}>
        Ordine {role}
      </label>
      <select
        className="input"
        disabled={!canEdit || saving || loading}
        value={currentKey ?? ""}
        onChange={(e) => select(e.target.value)}
      >
        <option value="">
          {loading ? "Caricamento…" : `— nessun ordine (${(orders ?? []).length} disponibili)`}
        </option>
        {(orders ?? []).map((o) => (
          <option key={o.key} value={o.key}>
            {o.tipork}/{o.anno}/{o.num} · {o.mainArticleDesc || o.mainArticleCode || "?"} ·{" "}
            {o.hours.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── Tab Componenti ─────────────────────────────────────── */
function TabComponenti({
  machine,
  onReplace,
  onDone,
  notify,
}: {
  machine: Machine;
  onReplace?: (c: { groupId: string; itemId: string; itemLabel: string; oldSerial: string }) => void;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [open, setOpen] = useState<string | null>(machine.components[0]?.groupId ?? null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);

  const totalSerials = machine.components.reduce(
    (a, c) => a + c.items.filter((i) => i.serial).length,
    0
  );

  async function uploadItemPhoto(files: FileList | null) {
    if (!files || !files.length || !target) return;
    const fd = new FormData();
    fd.append("photos", files[0]);
    fd.append("category", "componente");
    fd.append("componentItemId", target);
    const res = await fetch(`/api/machines/${machine.id}/photos`, { method: "POST", body: fd });
    setTarget(null);
    if (res.ok) {
      onDone();
      notify("Foto componente caricata");
    } else notify("Errore upload foto", "err");
  }

  const photoByItem = new Map<string, string>();
  machine.photos.forEach((p) => {
    /* fallback: mostriamo l'ultima foto di categoria componente se collegata */
  });

  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="cmp-summary">
          <span className="muted">Gruppi tracciati:</span>{" "}
          <strong>{machine.components.length}</strong>
          <span className="dot-sep"> · </span>
          <span className="muted">Matricole censite:</span> <strong>{totalSerials}</strong>
        </div>
      </div>

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => uploadItemPhoto(e.target.files)}
      />

      <div className="cmp-list">
        {COMPONENT_GROUPS.map((g) => {
          const c = machine.components.find((x) => x.groupId === g.id);
          if (!c) return null;
          const filled = c.items.filter((i) => i.serial).length;
          const isOpen = open === g.id;
          return (
            <div key={g.id} className={"cmp-row" + (isOpen ? " open" : "")}>
              <button
                className="cmp-row-head"
                onClick={() => setOpen(isOpen ? null : g.id)}
              >
                <span className="cmp-icon">
                  <Icon name={g.icon} size={20} />
                </span>
                <div className="cmp-name">
                  <div className="cmp-label">{g.label}</div>
                  <div className="cmp-en mono">{g.en}</div>
                </div>
                <div className="cmp-brand">{c.brand || "—"}</div>
                <div className="cmp-count">
                  <span
                    className={
                      "cmp-count-pill " +
                      (filled === g.slots.length && filled > 0
                        ? "full"
                        : filled > 0
                        ? "partial"
                        : "")
                    }
                  >
                    {filled} / {g.slots.length}
                  </span>
                </div>
                <Icon name={isOpen ? "chev-down" : "chev-right"} size={16} />
              </button>
              {isOpen && (
                <div className="cmp-row-body">
                  <div className="table-wrap">
                    <table className="cmp-table">
                      <thead>
                        <tr>
                          <th>Posizione</th>
                          <th>Matricola / S.N.</th>
                          <th>Foto</th>
                          <th>Note</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {c.items.map((it) => (
                          <tr key={it.id}>
                            <td>{it.label}</td>
                            <td className="mono">
                              {it.serial || <span className="muted">—</span>}
                            </td>
                            <td>
                              <button
                                className="thumb-empty"
                                title="Carica foto componente"
                                onClick={() => {
                                  setTarget(it.id);
                                  setTimeout(() => photoRef.current?.click(), 0);
                                }}
                              >
                                <Icon name="camera" size={16} />
                              </button>
                            </td>
                            <td className="muted">{it.note || (it.serial ? "—" : "Slot non occupato")}</td>
                            <td>
                              {it.serial && onReplace && (
                                <button
                                  className="btn-ghost-sm"
                                  onClick={() =>
                                    onReplace({
                                      groupId: g.id,
                                      itemId: it.id,
                                      itemLabel: `${g.label} — ${it.label}`,
                                      oldSerial: it.serial!,
                                    })
                                  }
                                >
                                  <Icon name="wrench" size={13} /> Sostituisci
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {g.extra &&
                          c.extra &&
                          g.extra.map((ex) => (
                            <tr key={ex.key} className="extra-row">
                              <td colSpan={2}>
                                <span className="muted">{ex.label}</span>
                              </td>
                              <td colSpan={3} className="mono">
                                {c.extra?.[ex.key] || "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tab Foto ───────────────────────────────────────────── */
const PHOTO_CATS = ["produzione", "telaio", "idraulica", "elettrico", "finiture", "collaudo", "intervento", "componente"];

function TabFoto({
  machine,
  onDone,
  notify,
}: {
  machine: Machine;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [cat, setCat] = useState("all");
  const [uploadCat, setUploadCat] = useState("produzione");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const filtered = cat === "all" ? machine.photos : machine.photos.filter((p) => p.category === cat);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("photos", f));
    fd.append("category", uploadCat);
    const res = await fetch(`/api/machines/${machine.id}/photos`, { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) {
      onDone();
      notify("Foto caricate");
    } else notify("Errore upload", "err");
  }

  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="filters">
          <button
            className={"chip-btn" + (cat === "all" ? " active" : "")}
            onClick={() => setCat("all")}
          >
            Tutte <span className="chip-n">{machine.photos.length}</span>
          </button>
          {PHOTO_CATS.map((p) => {
            const n = machine.photos.filter((x) => x.category === p).length;
            if (!n) return null;
            return (
              <button
                key={p}
                className={"chip-btn" + (cat === p ? " active" : "")}
                onClick={() => setCat(p)}
              >
                {p} <span className="chip-n">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="cmp-actions">
          <select
            className="input"
            style={{ maxWidth: 150 }}
            value={uploadCat}
            onChange={(e) => setUploadCat(e.target.value)}
          >
            {PHOTO_CATS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="btn-primary-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={14} /> Carica foto
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          className="upload-zone"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="camera" size={26} />
          <div>Nessuna foto in questa categoria — clicca per caricare</div>
        </div>
      ) : (
        <div className="photo-grid">
          {filtered.map((p) => (
            <figure key={p.id} className="photo-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.path} alt={p.caption || "foto"} />
              <figcaption>
                <div className="photo-title">{p.caption || p.category}</div>
                <div className="photo-meta mono">
                  {fmtDate(p.takenAt)} · {p.authorName || "—"}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tab Collaudo ───────────────────────────────────────── */
const SIGN_ROLES = ["Montaggio", "Collaudo", "Capo officina"];

const COLLAUDO_STATUS_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  DRAFT: { label: "Da compilare", color: "#6b7280", bg: "#f3f4f6" },
  IN_PROGRESS: { label: "In corso", color: "#b45309", bg: "#fef3c7" },
  PENDING_APPROVAL: { label: "In attesa di approvazione", color: "#1d4ed8", bg: "#dbeafe" },
  APPROVED: { label: "Approvato", color: "#0f9d68", bg: "#d1fae5" },
};

function checklistProgress(answers: Record<string, { value: string | null; note?: string }>) {
  let done = 0;
  for (const it of CHECKLIST_TRITURATORE) {
    const a = answers[String(it.n)];
    if (a && (a.value === "SI" || a.value === "NO" || a.value === "NA")) done++;
  }
  return { done, total: CHECKLIST_TRITURATORE.length };
}

function TabCollaudo({
  machine,
  onSign,
  currentUserId,
  canCompile,
  canApprove,
  onOpenChecklist,
}: {
  machine: Machine;
  onSign?: (role: string) => void;
  currentUserId: string;
  canCompile: boolean;
  canApprove: boolean;
  onOpenChecklist: (mode: "compile" | "approve" | "view") => void;
}) {
  const sigByRole = new Map(machine.signatures.map((s) => [s.role, s]));
  const c = machine.collaudo;
  const status = c?.status || "DRAFT";
  const meta = COLLAUDO_STATUS_META[status];
  const { done, total } = checklistProgress(c?.answers || {});
  const pct = Math.round((done / total) * 100);
  const isCompiler = c?.compilerId && c.compilerId === currentUserId;
  return (
    <div className="tab-content">
      <div className="grid-collaudo">
        <section className="card">
          <div className="card-header">
            <div>
              <h3>Verbale di collaudo · {machine.code}</h3>
              <div className="muted small">
                CL-{machine.year}-{machine.code.slice(-4)}
              </div>
            </div>
            <span
              className="phase-chip"
              style={{ background: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 0",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>
                Check list di collaudo trituratore (M7.3)
              </div>
              <div className="detail-progress-bar" style={{ width: "100%", height: 6 }}>
                <span style={{ width: pct + "%", background: meta.color }} />
              </div>
              <div className="mono small muted" style={{ marginTop: 4 }}>
                {done} / {total} voci compilate
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {status === "DRAFT" && canCompile && (
                <button className="btn-primary" onClick={() => onOpenChecklist("compile")}>
                  <Icon name="doc" size={14} /> Compila check list
                </button>
              )}
              {status === "IN_PROGRESS" && canCompile && (
                <button className="btn-primary" onClick={() => onOpenChecklist("compile")}>
                  <Icon name="doc" size={14} /> Continua compilazione
                </button>
              )}
              {status === "PENDING_APPROVAL" && (
                <>
                  <button className="btn-ghost" onClick={() => onOpenChecklist("view")}>
                    <Icon name="doc" size={14} /> Vedi check list
                  </button>
                  {canApprove && !isCompiler && (
                    <button className="btn-success" onClick={() => onOpenChecklist("approve")}>
                      <Icon name="check" size={14} /> Approva
                    </button>
                  )}
                </>
              )}
              {status === "APPROVED" && (
                <button className="btn-ghost" onClick={() => onOpenChecklist("view")}>
                  <Icon name="doc" size={14} /> Vedi check list
                </button>
              )}
            </div>
          </div>

          {(c?.compilerName || c?.approverName) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              {c?.compilerName && (
                <div className="muted small">
                  Compilato da <strong style={{ color: "var(--text)" }}>{c.compilerName}</strong>{" "}
                  il <span className="mono">{fmtDate(c.compiledAt)}</span>
                </div>
              )}
              {c?.approverName && (
                <div className="muted small">
                  Approvato da <strong style={{ color: "var(--text)" }}>{c.approverName}</strong>{" "}
                  il <span className="mono">{fmtDate(c.approvedAt)}</span>
                </div>
              )}
            </div>
          )}

          <div className="card-divider" />
          <h4 className="check-group-h">Riepilogo verifiche dal diario</h4>
          <ul className="check-list">
            {machine.diary
              .filter((d) => d.phase === "TESTING" || d.phase === "PRODUCTION")
              .slice(-6)
              .map((d) => (
                <li className="check-item" key={d.id}>
                  <span className="check-box on">
                    <Icon name="check" size={12} />
                  </span>
                  <div>{d.title}</div>
                  <div className="check-value mono small">{fmtDate(d.date)}</div>
                  <div className="check-tol">{d.actorName}</div>
                </li>
              ))}
            {machine.diary.filter((d) => d.phase === "TESTING" || d.phase === "PRODUCTION").length === 0 && (
              <li className="muted small">Nessuna verifica registrata nel diario.</li>
            )}
          </ul>
        </section>

        <section className="card">
          <div className="card-header"><h3>Firme</h3></div>
          {SIGN_ROLES.map((role) => {
            const s = sigByRole.get(role);
            return (
              <div key={role} className={"sig-block" + (s ? " signed" : "")}>
                <div>
                  <div className="sig-role">{role}</div>
                  <div className="sig-name">{s ? s.signerName : "In attesa di firma"}</div>
                  <div className="sig-date mono">
                    {s ? fmtDate(s.signedAt) : "—"}
                  </div>
                </div>
                <div className="sig-block-area">
                  {s ? (
                    s.imageData ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="sig-img" src={s.imageData} alt="firma" />
                    ) : (
                      <span className="sig-pin-mark">
                        <Icon name="check" size={14} /> Firmato con PIN
                      </span>
                    )
                  ) : onSign ? (
                    <button className="btn-primary-sm" onClick={() => onSign(role)}>
                      <Icon name="sign" size={14} /> Firma
                    </button>
                  ) : (
                    <span className="muted small">In attesa di firma</span>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

/* ── Tab Diario ─────────────────────────────────────────── */
function TabDiario({
  machine,
  onIntervention,
}: {
  machine: Machine;
  onIntervention?: () => void;
}) {
  const milestoneEvents: Diary[] = machine.milestones
    .map((m) => {
      const def = milestoneDef(m.key);
      if (!def) return null;
      return {
        id: "ms-" + m.key,
        phase: def.phase as string,
        type: "status",
        title: `${def.label} — cambio stato`,
        note: `Data ${def.label.toLowerCase()} (${m.source === "GESTIONALE" ? "gestionale" : "inserita a mano"}).`,
        date: m.date,
        actorName: m.source === "GESTIONALE" ? "Gestionale" : "Inserimento manuale",
        oldSerial: null,
        newSerial: null,
        signed: false,
        photos: [] as { id: string; path: string; caption: string | null }[],
      } as Diary;
    })
    .filter((x): x is Diary => x !== null);

  const events = [...machine.diary, ...milestoneEvents].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="cmp-summary">
          <span className="muted">Eventi:</span> <strong>{events.length}</strong>
          <span className="dot-sep"> · </span>
          <span className="muted">Primo:</span>{" "}
          <strong className="mono">{events[0] ? fmtDate(events[0].date) : "—"}</strong>
          <span className="dot-sep"> · </span>
          <span className="muted">Ultimo:</span>{" "}
          <strong className="mono">
            {events.length ? fmtDate(events[events.length - 1].date) : "—"}
          </strong>
        </div>
        {onIntervention && (
          <button className="btn-primary-sm" onClick={onIntervention}>
            <Icon name="plus" size={14} /> Nuovo intervento
          </button>
        )}
      </div>
      <ol className="timeline">
        {events.map((e, i) => {
          const pm = PHASE_META[e.phase as keyof typeof PHASE_META];
          return (
            <li key={e.id} className="tl-item">
              <div className="tl-rail">
                <span className="tl-dot" style={{ background: pm?.color }} />
                {i < events.length - 1 && <span className="tl-line" />}
              </div>
              <div className="tl-card">
                <div className="tl-head">
                  <span
                    className="phase-chip"
                    style={{ background: (pm?.color || "#888") + "22", color: pm?.color }}
                  >
                    {pm?.label}
                  </span>
                  <span className="tl-date mono">{fmtDate(e.date)}</span>
                  {e.signed && (
                    <span className="tl-signed">
                      <Icon name="check" size={12} /> firmato
                    </span>
                  )}
                </div>
                <h4 className="tl-title">{e.title}</h4>
                {e.note && <p className="tl-note">{e.note}</p>}
                <div className="tl-foot">
                  <span className="muted small">{e.actorName}</span>
                  {(e.oldSerial || e.newSerial) && (
                    <span className="tl-sn">
                      S/N: {e.oldSerial || "—"} → {e.newSerial || "—"}
                    </span>
                  )}
                </div>
                {e.photos.length > 0 && (
                  <div className="tl-photos">
                    {e.photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} src={p.path} alt={p.caption || ""} />
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {events.length === 0 && <li className="empty">Nessun evento registrato.</li>}
      </ol>
    </div>
  );
}

/* ── Tab QR ─────────────────────────────────────────────── */
function TabQR({ machine, qrDataUrl }: { machine: Machine; qrDataUrl: string }) {
  return (
    <div className="tab-content">
      <div className="grid-qr">
        <section className="card">
          <div className="card-header">
            <h3>Etichetta macchina</h3>
            <button className="btn-ghost-sm" onClick={() => window.print()}>
              <Icon name="download" size={14} /> Stampa
            </button>
          </div>
          <div className="label-preview">
            <div className="label-paper">
              <div className="label-top">
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="label-logo" src="/zato-logo.png" alt="ZATO" />
                  <div className="label-brand mono">FASCICOLO TECNICO</div>
                  <div className="label-id">{machine.code}</div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr-img" src={qrDataUrl} alt="QR" />
              </div>
              <dl className="label-kv">
                <dt>Tipologia</dt><dd>{machine.plantType || "—"}</dd>
                <dt>Modello</dt><dd>{machine.model}</dd>
                <dt>Job</dt><dd className="mono">{machine.job}</dd>
                <dt>Anno</dt><dd>{machine.year}</dd>
                <dt>Cliente</dt><dd>{machine.customer}</dd>
                <dt>Sito</dt><dd>{machine.site || "—"}</dd>
                <dt>Pressione</dt><dd className="mono">{machine.pressureSettings || "—"}</dd>
              </dl>
              <div className="label-foot mono">
                Scansiona per accedere al fascicolo · fascicolo.zato.it/macchine/{machine.code}
              </div>
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-header"><h3>Pagina del fascicolo</h3></div>
          <p className="muted small">
            Stampa ed applica l&apos;etichetta QR sulla macchina. Inquadrandola dal campo
            (smartphone/tablet) si accede al fascicolo completo: anagrafica, componenti,
            storico interventi e manuali.
          </p>
          <div className="card-divider" />
          <h4 className="check-group-h">Contenuto del fascicolo</h4>
          <ul className="doc-list">
            <li><Icon name="doc" size={16} /> <span className="fname">Anagrafica e targa tecnica</span></li>
            <li><Icon name="gear" size={16} /> <span className="fname">{machine.components.length} gruppi componenti tracciati</span></li>
            <li><Icon name="image" size={16} /> <span className="fname">{machine.photos.length} foto</span></li>
            <li><Icon name="clock" size={16} /> <span className="fname">{machine.diary.length} eventi nel diario</span></li>
            <li><Icon name="sign" size={16} /> <span className="fname">{machine.signatures.length} firme registrate</span></li>
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ── Tab Service (interventi + chat collegati al fascicolo) ─ */
function TabService({
  machine,
  service,
  caps,
  notify,
}: {
  machine: Machine;
  service: ServiceData;
  caps: { interventoCreate: boolean; chatSend: boolean };
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"int" | "chat" | null>(null);

  async function newIntervento() {
    setBusy("int");
    try {
      const res = await fetch("/api/interventi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Intervento su ${machine.job || machine.code}`,
          machineId: machine.id,
          customerId: machine.customerId ?? undefined,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) router.push(`/service/interventi/${d.id}`);
      else notify(d?.error ?? "Errore", "err");
    } finally {
      setBusy(null);
    }
  }

  async function openChat() {
    setBusy("chat");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Chat ${machine.job || machine.code}`,
          machineId: machine.id,
          customerId: machine.customerId ?? undefined,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) router.push(`/service/chat?conv=${d.id}`);
      else notify(d?.error ?? "Errore", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tab-content">
      <div className="grid-two">
        <section className="card">
          <div className="card-header">
            <h3>Interventi in cantiere</h3>
            {caps.interventoCreate && (
              <button className="btn-ghost-sm" onClick={newIntervento} disabled={busy !== null}>
                <Icon name="plus" size={13} /> {busy === "int" ? "…" : "Nuovo"}
              </button>
            )}
          </div>
          <ul className="mini-list">
            {service.interventi.map((i) => {
              const m = INTERVENTO_STATUS_META[i.status];
              const prio = PRIORITY_META[i.priority] ?? PRIORITY_META[3];
              return (
                <li key={i.id}>
                  <Link href={`/service/interventi/${i.id}`} className="mini-row">
                    <span className="mono muted small">{i.code}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{i.title}</span>
                    <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>{prio.short}</span>
                    <span className="status-chip" style={{ background: m.color + "22", color: m.color }}>{m.label}</span>
                  </Link>
                </li>
              );
            })}
            {service.interventi.length === 0 && (
              <li className="muted small">Nessun intervento di service per questa macchina.</li>
            )}
          </ul>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Conversazioni</h3>
            {caps.chatSend && (
              <button className="btn-ghost-sm" onClick={openChat} disabled={busy !== null}>
                <Icon name="sign" size={13} /> {busy === "chat" ? "…" : "Apri chat"}
              </button>
            )}
          </div>
          <ul className="mini-list">
            {service.chats.map((c) => (
              <li key={c.id}>
                <Link href={`/service/chat?conv=${c.id}`} className="mini-row">
                  <span style={{ flex: 1, fontWeight: 600 }}>{c.contactName ?? c.title}</span>
                  <span className="muted small">{c.channel}</span>
                  <span className="mono muted small">{c.messages} msg</span>
                </Link>
              </li>
            ))}
            {service.chats.length === 0 && (
              <li className="muted small">Nessuna conversazione collegata.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ── Intervention Modal ─────────────────────────────────── */
function InterventionModal({
  machine,
  prefill,
  currentUser,
  onClose,
  onSaved,
  onError,
}: {
  machine: Machine;
  prefill: { groupId?: string; itemId?: string; itemLabel?: string; oldSerial?: string };
  currentUser: { name: string; hasPin: boolean };
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const isReplace = !!prefill.itemId;
  const [phase, setPhase] = useState(isReplace ? "MAINTENANCE" : "MAINTENANCE");
  const [type, setType] = useState(isReplace ? "replace" : "note");
  const [title, setTitle] = useState(
    isReplace ? `Sostituzione ${prefill.itemLabel}` : ""
  );
  const [note, setNote] = useState("");
  const [oldSerial, setOldSerial] = useState(prefill.oldSerial || "");
  const [newSerial, setNewSerial] = useState("");
  const [actor, setActor] = useState(currentUser.name);
  const [signMethod, setSignMethod] = useState<"PEN" | "PIN">(
    currentUser.hasPin ? "PIN" : "PEN"
  );
  const [pin, setPin] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  async function save() {
    if (!title.trim()) return onError("Titolo intervento obbligatorio");
    setBusy(true);
    const fd = new FormData();
    fd.append("phase", phase);
    fd.append("type", type);
    fd.append("title", title);
    fd.append("note", note);
    fd.append("actorName", actor);
    if (type === "replace") {
      fd.append("oldSerial", oldSerial);
      fd.append("newSerial", newSerial);
      if (prefill.itemId) fd.append("componentItemId", prefill.itemId);
      if (prefill.itemLabel) fd.append("componentRef", prefill.itemLabel);
    }
    fd.append("signMethod", signMethod);
    if (signMethod === "PIN") fd.append("pin", pin);
    else {
      if (sigRef.current?.isEmpty()) {
        setBusy(false);
        return onError("Apporre la firma a penna");
      }
      fd.append("signatureData", sigRef.current?.toDataURL() || "");
    }
    if (files) Array.from(files).forEach((f) => fd.append("photos", f));

    const res = await fetch(`/api/machines/${machine.id}/intervention`, {
      method: "POST",
      body: fd,
    });
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      onError(d.error || "Errore registrazione intervento");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Nuovo intervento</h2>
            <div className="muted small">
              Macchina <span className="mono">{machine.code}</span> · {machine.customer}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>Fase del ciclo di vita</label>
            <div className="seg">
              {[
                ["PRODUCTION", "Produzione"],
                ["TESTING", "Collaudo"],
                ["INSTALLED", "Installazione"],
                ["MAINTENANCE", "Manutenzione"],
                ["SCRAPPED", "Rottamazione"],
              ].map(([id, l]) => (
                <button
                  key={id}
                  className={"seg-btn" + (phase === id ? " active" : "")}
                  onClick={() => setPhase(id)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>Tipo intervento</label>
            <div className="seg">
              {[
                ["replace", "Sostituzione"],
                ["inspect", "Ispezione"],
                ["repair", "Riparazione"],
                ["note", "Annotazione"],
              ].map(([id, l]) => (
                <button
                  key={id}
                  className={"seg-btn" + (type === id ? " active" : "")}
                  onClick={() => setType(id)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {type === "replace" && (
            <div className="form-grid">
              <div className="form-row">
                <label>Componente</label>
                <input className="input" value={prefill.itemLabel || ""} readOnly placeholder="Seleziona dal tab Componenti" />
              </div>
              <div className="form-row">
                <label>Matricola rimossa</label>
                <input
                  className="input mono"
                  value={oldSerial}
                  onChange={(e) => setOldSerial(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Matricola nuova</label>
                <input
                  className="input mono"
                  value={newSerial}
                  onChange={(e) => setNewSerial(e.target.value)}
                  placeholder="es. HYX222P00301"
                />
              </div>
            </div>
          )}

          <div className="form-row">
            <label>Titolo intervento</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Breve descrizione"
            />
          </div>
          <div className="form-row">
            <label>Note</label>
            <textarea
              className="input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cosa è stato fatto, perché, esiti, materiali…"
            />
          </div>
          <div className="form-row">
            <label>Foto allegate</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(e.target.files)}
            />
          </div>
          <div className="form-row">
            <label>Operatore</label>
            <input className="input" value={actor} onChange={(e) => setActor(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Firma digitale</label>
            <div className="seg">
              <button
                className={"seg-btn" + (signMethod === "PIN" ? " active" : "")}
                onClick={() => setSignMethod("PIN")}
              >
                <Icon name="pin" size={14} /> PIN personale
              </button>
              <button
                className={"seg-btn" + (signMethod === "PEN" ? " active" : "")}
                onClick={() => setSignMethod("PEN")}
              >
                <Icon name="sign" size={14} /> Firma a penna
              </button>
            </div>
            {signMethod === "PIN" ? (
              <div className="pin-row">
                <input
                  className="input mono pin-input"
                  type="password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                />
                <span className="muted small">
                  {currentUser.hasPin
                    ? "Inserisci il tuo PIN a 4-6 cifre"
                    : "Nessun PIN impostato: usa la firma a penna"}
                </span>
              </div>
            ) : (
              <div>
                <SignaturePad ref={sigRef} height={150} />
                <div className="sig-actions">
                  <button
                    className="btn-ghost-sm"
                    onClick={() => sigRef.current?.clear()}
                  >
                    Cancella
                  </button>
                  <span className="muted small">
                    Firmando dichiari di aver eseguito l&apos;intervento secondo le procedure ZATO.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            <Icon name="check" size={14} /> {busy ? "Registro…" : "Registra intervento"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ── Sign Modal (collaudo) ──────────────────────────────── */
function SignModal({
  machine,
  role,
  currentUser,
  onClose,
  onSaved,
  onError,
}: {
  machine: Machine;
  role: string;
  currentUser: { name: string; hasPin: boolean };
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(currentUser.name);
  const [method, setMethod] = useState<"PEN" | "PIN">(currentUser.hasPin ? "PIN" : "PEN");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  async function confirm() {
    setBusy(true);
    const body: Record<string, string> = { role, signerName: name, method };
    if (method === "PIN") body.pin = pin;
    else {
      if (sigRef.current?.isEmpty()) {
        setBusy(false);
        return onError("Apporre la firma a penna");
      }
      body.signatureData = sigRef.current?.toDataURL() || "";
    }
    const res = await fetch(`/api/machines/${machine.id}/signature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      onError(d.error || "Errore firma");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Firma — {role}</h2>
            <div className="muted small">Verbale di collaudo · {machine.code}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>Nome firmatario</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Metodo</label>
            <div className="seg">
              <button
                className={"seg-btn" + (method === "PIN" ? " active" : "")}
                onClick={() => setMethod("PIN")}
              >
                <Icon name="pin" size={14} /> PIN
              </button>
              <button
                className={"seg-btn" + (method === "PEN" ? " active" : "")}
                onClick={() => setMethod("PEN")}
              >
                <Icon name="sign" size={14} /> Penna
              </button>
            </div>
          </div>
          {method === "PIN" ? (
            <div className="pin-row">
              <input
                className="input mono pin-input"
                type="password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
              />
              <span className="muted small">PIN personale a 4-6 cifre</span>
            </div>
          ) : (
            <div>
              <SignaturePad ref={sigRef} height={150} />
              <div className="sig-actions">
                <button className="btn-ghost-sm" onClick={() => sigRef.current?.clear()}>
                  Cancella
                </button>
              </div>
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Annulla
          </button>
          <button className="btn-primary" disabled={busy} onClick={confirm}>
            <Icon name="check" size={14} /> {busy ? "Firmo…" : "Conferma firma"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ── Collaudo (Check list) Modal ────────────────────────── */
type AnsVal = "SI" | "NO" | "NA" | null;
type AnsMap = Record<string, { value: AnsVal; note: string }>;

function CollaudoModal({
  machine,
  mode,
  currentUser,
  onClose,
  onSaved,
  onError,
}: {
  machine: Machine;
  mode: "compile" | "approve" | "view";
  currentUser: { id: string; name: string; hasSignature: boolean };
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const c = machine.collaudo;
  const readonly = mode === "view" || mode === "approve";

  // Hydrate answers from collaudo (or empty)
  const [answers, setAnswers] = useState<AnsMap>(() => {
    const out: AnsMap = {};
    for (const it of CHECKLIST_TRITURATORE) {
      const a = c?.answers?.[String(it.n)];
      out[String(it.n)] = {
        value: ((a?.value === "SI" || a?.value === "NO" || a?.value === "NA") ? a.value : null) as AnsVal,
        note: a?.note || "",
      };
    }
    return out;
  });

  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [useSavedSig, setUseSavedSig] = useState(currentUser.hasSignature);
  const [saveSignature, setSaveSignature] = useState(!currentUser.hasSignature);
  const sigRef = useRef<SignaturePadHandle>(null);

  const done = CHECKLIST_TRITURATORE.reduce(
    (n, it) => n + (answers[String(it.n)].value ? 1 : 0),
    0
  );
  const total = CHECKLIST_TRITURATORE.length;
  const allDone = done === total;

  function setVal(n: number, v: AnsVal) {
    if (readonly) return;
    setAnswers((s) => ({ ...s, [String(n)]: { ...s[String(n)], value: v } }));
  }
  function setNote(n: number, note: string) {
    if (readonly) return;
    setAnswers((s) => ({ ...s, [String(n)]: { ...s[String(n)], note } }));
  }

  async function saveDraft() {
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/collaudo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", answers }),
    });
    setBusy(false);
    if (res.ok) onSaved("Bozza check list salvata");
    else {
      const d = await res.json().catch(() => ({}));
      onError(d.error || "Errore salvataggio bozza");
    }
  }

  async function submitCompile() {
    if (!allDone) return onError("Tutte le voci devono avere SI / NO / N.A.");
    let signatureData: string | null = null;
    if (useSavedSig && currentUser.hasSignature) {
      // server userà la firma salvata sull'utente
      signatureData = null;
    } else {
      if (sigRef.current?.isEmpty()) return onError("Apporre la firma del compilatore");
      signatureData = sigRef.current?.toDataURL() || null;
    }
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/collaudo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        answers,
        compilerSignature: signatureData,
        saveSignature: !!signatureData && saveSignature,
      }),
    });
    setBusy(false);
    if (res.ok) onSaved("Check list inviata per approvazione");
    else {
      const d = await res.json().catch(() => ({}));
      onError(d.error || "Errore invio check list");
    }
  }

  async function approve() {
    let signatureData: string | null = null;
    if (useSavedSig && currentUser.hasSignature) {
      signatureData = null;
    } else {
      if (sigRef.current?.isEmpty()) return onError("Apporre la firma dell'approvatore");
      signatureData = sigRef.current?.toDataURL() || null;
    }
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/collaudo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        approverSignature: signatureData,
        saveSignature: !!signatureData && saveSignature,
        remarks: remarks || null,
      }),
    });
    setBusy(false);
    if (res.ok) onSaved("Verbale di collaudo approvato");
    else {
      const d = await res.json().catch(() => ({}));
      onError(d.error || "Errore approvazione");
    }
  }

  const title =
    mode === "approve"
      ? "Approva verbale di collaudo"
      : mode === "view"
      ? "Verbale di collaudo"
      : "Compila check list di collaudo";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(900px, 96vw)", maxHeight: "92vh" }}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            <div className="muted small">
              Macchina <span className="mono">{machine.code}</span> · {machine.customer} ·{" "}
              CL-{machine.year}-{machine.code.slice(-4)} · {done}/{total} compilate
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="modal-body" style={{ gap: 0 }}>
          <div
            className="muted small"
            style={{
              position: "sticky",
              top: 0,
              background: "var(--surface)",
              padding: "6px 0 10px",
              borderBottom: "1px solid var(--border)",
              marginBottom: 10,
              zIndex: 1,
            }}
          >
            CHECK LIST COLLAUDO TRITURATORE — M7.3 (63 voci)
          </div>

          {CHECKLIST_TRITURATORE.map((it) => {
            const a = answers[String(it.n)];
            return (
              <div
                key={it.n}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px dashed var(--border)",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div
                    className="mono muted"
                    style={{ minWidth: 28, paddingTop: 6, fontWeight: 600 }}
                  >
                    {it.n}.
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, lineHeight: 1.45 }}>{it.text}</div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {(["SI", "NO", "NA"] as const).map((v) => {
                        const active = a.value === v;
                        const tone =
                          v === "SI" ? "#0f9d68" : v === "NO" ? "#dc2626" : "#6b7280";
                        return (
                          <button
                            key={v}
                            type="button"
                            disabled={readonly}
                            onClick={() => setVal(it.n, v)}
                            className="chip-btn"
                            style={{
                              cursor: readonly ? "default" : "pointer",
                              borderColor: active ? tone : "var(--border)",
                              background: active ? tone : "var(--surface)",
                              color: active ? "#fff" : tone,
                              fontWeight: 600,
                              padding: "5px 14px",
                              opacity: readonly && !active ? 0.4 : 1,
                            }}
                          >
                            {v === "NA" ? "N.A." : v}
                          </button>
                        );
                      })}
                      <input
                        className="input"
                        placeholder="Note (opzionale)"
                        value={a.note}
                        onChange={(e) => setNote(it.n, e.target.value)}
                        readOnly={readonly}
                        style={{ flex: 1, minWidth: 200 }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Footer: compilatore + approvatore */}
          <div
            style={{
              marginTop: 16,
              padding: 14,
              background: "var(--bg-3)",
              borderRadius: 10,
              border: "1px solid var(--border)",
            }}
          >
            <h4 className="check-group-h" style={{ margin: "0 0 12px" }}>
              Compilatore
            </h4>
            <div className="form-grid">
              <div className="form-row">
                <label>Nome compilatore</label>
                <input
                  className="input"
                  readOnly
                  value={c?.compilerName || currentUser.name}
                />
              </div>
              <div className="form-row">
                <label>Data compilazione</label>
                <input
                  className="input mono"
                  readOnly
                  value={c?.compiledAt ? fmtDate(c.compiledAt) : fmtDate(new Date().toISOString())}
                />
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 10 }}>
              <label>Firma compilatore</label>
              {c?.compilerSignature ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={c.compilerSignature}
                  alt="firma"
                  style={{ maxHeight: 80, background: "#fff", border: "1px solid var(--border)", borderRadius: 6, padding: 4 }}
                />
              ) : mode === "compile" ? (
                currentUser.hasSignature && useSavedSig ? (
                  <div
                    style={{
                      padding: 12,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <Icon name="check" size={16} color="var(--green)" />
                    <span className="small">Verrà usata la firma salvata sul tuo profilo.</span>
                    <button
                      className="btn-ghost-sm"
                      style={{ marginLeft: "auto" }}
                      type="button"
                      onClick={() => setUseSavedSig(false)}
                    >
                      Disegna nuova
                    </button>
                  </div>
                ) : (
                  <div>
                    <SignaturePad ref={sigRef} height={120} />
                    <div className="sig-actions">
                      <button
                        className="btn-ghost-sm"
                        type="button"
                        onClick={() => sigRef.current?.clear()}
                      >
                        Cancella
                      </button>
                      <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={saveSignature}
                          onChange={(e) => setSaveSignature(e.target.checked)}
                        />
                        Salva firma sul mio profilo
                      </label>
                      {currentUser.hasSignature && (
                        <button
                          className="btn-ghost-sm"
                          type="button"
                          onClick={() => setUseSavedSig(true)}
                        >
                          Usa firma salvata
                        </button>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <span className="muted small">— da firmare</span>
              )}
            </div>

            {(mode === "approve" || mode === "view" || c?.approverName) && (
              <>
                <div className="card-divider" />
                <h4 className="check-group-h" style={{ margin: "0 0 12px" }}>
                  Approvato da
                </h4>
                <div className="form-grid">
                  <div className="form-row">
                    <label>Nome approvatore</label>
                    <input
                      className="input"
                      readOnly
                      value={c?.approverName || (mode === "approve" ? currentUser.name : "")}
                      placeholder="—"
                    />
                  </div>
                  <div className="form-row">
                    <label>Data approvazione</label>
                    <input
                      className="input mono"
                      readOnly
                      value={
                        c?.approvedAt
                          ? fmtDate(c.approvedAt)
                          : mode === "approve"
                          ? fmtDate(new Date().toISOString())
                          : "—"
                      }
                    />
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: 10 }}>
                  <label>Note approvazione</label>
                  <textarea
                    className="input"
                    rows={2}
                    readOnly={mode !== "approve"}
                    value={mode === "approve" ? remarks : c?.approverRemarks || ""}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder={mode === "approve" ? "Eventuali note dell'approvatore" : "—"}
                  />
                </div>
                <div className="form-row" style={{ marginTop: 10 }}>
                  <label>Firma approvatore</label>
                  {c?.approverSignature ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={c.approverSignature}
                      alt="firma approvatore"
                      style={{ maxHeight: 80, background: "#fff", border: "1px solid var(--border)", borderRadius: 6, padding: 4 }}
                    />
                  ) : mode === "approve" ? (
                    currentUser.hasSignature && useSavedSig ? (
                      <div
                        style={{
                          padding: 12,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <Icon name="check" size={16} color="var(--green)" />
                        <span className="small">Verrà usata la firma salvata sul tuo profilo.</span>
                        <button
                          className="btn-ghost-sm"
                          style={{ marginLeft: "auto" }}
                          type="button"
                          onClick={() => setUseSavedSig(false)}
                        >
                          Disegna nuova
                        </button>
                      </div>
                    ) : (
                      <div>
                        <SignaturePad ref={sigRef} height={120} />
                        <div className="sig-actions">
                          <button
                            className="btn-ghost-sm"
                            type="button"
                            onClick={() => sigRef.current?.clear()}
                          >
                            Cancella
                          </button>
                          <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={saveSignature}
                              onChange={(e) => setSaveSignature(e.target.checked)}
                            />
                            Salva firma sul mio profilo
                          </label>
                          {currentUser.hasSignature && (
                            <button
                              className="btn-ghost-sm"
                              type="button"
                              onClick={() => setUseSavedSig(true)}
                            >
                              Usa firma salvata
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <span className="muted small">— da firmare</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Chiudi
          </button>
          {mode === "compile" && (
            <>
              <button className="btn-ghost" disabled={busy} onClick={saveDraft}>
                Salva bozza
              </button>
              <button
                className="btn-primary"
                disabled={busy || !allDone}
                onClick={submitCompile}
                title={!allDone ? "Compila tutte le voci prima di inviare" : ""}
              >
                <Icon name="check" size={14} /> {busy ? "Invio…" : "Invia per approvazione"}
              </button>
            </>
          )}
          {mode === "approve" && (
            <button className="btn-success" disabled={busy} onClick={approve}>
              <Icon name="check" size={14} /> {busy ? "Approvo…" : "Approva verbale"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
