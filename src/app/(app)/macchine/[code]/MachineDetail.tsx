"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { Flag } from "@/components/Icon";
import { SignaturePad, SignaturePadHandle } from "@/components/SignaturePad";
import CustomerPicker, { type CustomerHit } from "@/components/CustomerPicker";
import { COMPONENT_GROUPS } from "@/lib/components";
import {
  STATUS_META,
  PHASE_META,
  STATUS_ORDER,
  INTERVENTO_STATUS_META,
  PRIORITY_META,
  COUNTRIES,
} from "@/lib/domain";
import { CUSTOM_MODEL, hasTiranteGiunto } from "@/lib/plant";
import { hasAllestimentoSheets } from "@/lib/allestimento";
import AllestimentoSheets from "@/components/AllestimentoSheets";
import { MILESTONES, milestoneDef, SOURCE_LABEL, isAutoSource } from "@/lib/milestones";
import { checklistFor, type ChecklistItem } from "@/lib/checklist";
import { fmtDate, fmtBytes, fmtDateTime } from "@/lib/format";
import { downscaleImage } from "@/lib/image";
import type { MachineStatus, InterventoStatus } from "@prisma/client";

type ServiceData = {
  interventi: { id: string; code: string; title: string; status: InterventoStatus; priority: number }[];
  chats: { id: string; title: string; channel: string; contactName: string | null; messages: number }[];
};

type Item = { id: string; position: number; label: string; serial: string | null; note: string | null };
type Comp = { id: string; groupId: string; label: string | null; brand: string | null; extra: Record<string, string> | null; items: Item[] };
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
  tiranteGiunto: boolean;
  components: Comp[];
  diary: Diary[];
  photos: {
    id: string; path: string; category: string; caption: string | null;
    authorId: string | null; authorName: string | null; takenAt: string;
    componentItemId: string | null; componentLabel: string | null;
    interventoId: string | null; interventoCode: string | null; interventoTitle: string | null;
    diaryEventId: string | null; diaryTitle: string | null; diaryDate: string | null;
    deletedAt: string | null; deletedByName: string | null;
  }[];
  photoTrash: Machine["photos"];
  documents: { id: string; name: string; path: string; sizeBytes: number; category: string }[];
  signatures: { id: string; role: string; signerName: string; method: string; imageData: string | null; signedAt: string }[];
  milestones: { key: string; date: string; source: string; detail: string | null }[];
  notesLog: {
    id: string; text: string; authorId: string | null; authorName: string; createdAt: string;
    editedByName: string | null; editedAt: string | null;
    deletedAt: string | null; deletedByName: string | null;
    revisions: { id: string; text: string; editedByName: string; editedAt: string }[];
  }[];
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
  { id: "note", label: "Note", icon: "doc" },
];

export type PlantConfig = { name: string; models: string[] }[];

export default function MachineDetail({
  machine,
  plantConfig,
  qrDataUrl,
  service,
  currentUser,
  caps,
}: {
  machine: Machine;
  plantConfig: PlantConfig;
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
    customerManage?: boolean;
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
        <TabAnagrafica
          machine={machine}
          plantConfig={plantConfig}
          canEdit={caps.edit}
          onDone={refresh}
          notify={notify}
        />
      )}
      {tab === "componenti" && (
        <TabComponenti
          machine={machine}
          canEdit={caps.intervention}
          canSign={caps.intervention}
          canManageOptions={caps.edit}
          hasSavedSignature={currentUser.hasSignature}
          onReplace={caps.intervention ? (c) => setIntervention(c) : undefined}
          onDone={refresh}
          notify={notify}
        />
      )}
      {tab === "foto" && (
        <TabFoto
          machine={machine}
          userId={currentUser.id}
          canEdit={caps.edit}
          onDone={refresh}
          notify={notify}
        />
      )}
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
      {tab === "note" && (
        <TabNote
          machine={machine}
          currentUserId={currentUser.id}
          canAdd={caps.intervention || caps.edit}
          canEditAll={caps.edit}
          onDone={refresh}
          notify={notify}
        />
      )}

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
  plantConfig,
  canEdit,
  onDone,
  notify,
}: {
  machine: Machine;
  plantConfig: PlantConfig;
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

  const msRow = (key: string) => machine.milestones.find((x) => x.key === key) ?? null;
  const msAuto = (key: string) => isAutoSource(msRow(key)?.source);
  const msOrigin = (key: string) => {
    const r = msRow(key);
    return r ? r.detail ?? SOURCE_LABEL[r.source] ?? r.source : null;
  };

  async function saveMilestones() {
    const initial = msInit();
    // solo le date manuali cambiate: quelle automatiche prevalgono sempre
    const items = MILESTONES.filter(
      (d) => !msAuto(d.key) && (ms[d.key] || "") !== (initial[d.key] || "")
    ).map((d) => ({ key: d.key, date: ms[d.key] || "" }));
    if (!items.length) {
      setEditMs(false);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
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

  // ── Modifica anagrafica (ogni campo del fascicolo è correggibile) ──
  const plantNames = plantConfig.map((x) => x.name);
  const modelsFor = (pt: string) => [
    ...(plantConfig.find((x) => x.name === pt)?.models ?? []),
    CUSTOM_MODEL,
  ];
  const initForm = () => {
    const pt = machine.plantType || plantNames[0] || "";
    const known = modelsFor(pt).includes(machine.model);
    return {
      job: machine.job,
      jobBody: machine.jobBody || "",
      jobContainer: machine.jobContainer || "",
      plantType: pt,
      model: known ? machine.model : CUSTOM_MODEL,
      customModel: known ? "" : machine.model,
      year: String(machine.year),
      customer: machine.customer,
      customerId: machine.customerId || "",
      countryCode: machine.countryCode,
      site: machine.site || "",
      productionStart: isoToDay(machine.productionStart || undefined),
      deliveryDate: isoToDay(machine.deliveryDate || undefined),
      plateWeight: machine.plateWeight || "",
      platePower: machine.platePower || "",
      plateVoltage: machine.plateVoltage || "",
      pressureSettings: machine.pressureSettings || "",
    };
  };
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(initForm);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const setFF = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));

  function startEdit() {
    setForm(initForm());
    setSites([]);
    setEdit(true);
  }
  function cancelEdit() {
    setForm(initForm());
    setEdit(false);
  }
  function pickCustomer(c: CustomerHit | null) {
    setSites(c?.sites ?? []);
    setForm((s) => ({
      ...s,
      customer: c?.name ?? "",
      customerId: c?.id ?? "",
      countryCode: c?.countryCode && c.countryCode !== "XX" ? c.countryCode : s.countryCode,
    }));
  }

  async function saveAnagrafica() {
    if (!form.job.trim()) return notify("Il Job Number è obbligatorio", "err");
    const model = form.model === CUSTOM_MODEL ? form.customModel.trim() : form.model;
    if (!model) return notify("Specifica il modello", "err");
    const year = Number(form.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100)
      return notify("Anno non valido", "err");
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: form.job,
        jobBody: form.jobBody,
        jobContainer: form.jobContainer,
        plantType: form.plantType,
        model,
        year,
        customerId: form.customerId,
        customer: form.customer,
        countryCode: form.countryCode,
        site: form.site,
        productionStart: form.productionStart,
        deliveryDate: form.deliveryDate,
        plateWeight: form.plateWeight,
        platePower: form.platePower,
        plateVoltage: form.plateVoltage,
        pressureSettings: form.pressureSettings,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setEdit(false);
      onDone();
      notify("Anagrafica aggiornata");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore salvataggio", "err");
    }
  }

  /** Pulsanti Modifica / Annulla+Salva ripetuti sulle card modificabili. */
  const editButtons = !canEdit ? null : edit ? (
    <div style={{ display: "flex", gap: 6 }}>
      <button className="btn-ghost-sm" onClick={cancelEdit}>
        Annulla
      </button>
      <button className="btn-primary-sm" disabled={busy} onClick={saveAnagrafica}>
        <Icon name="check" size={13} /> Salva
      </button>
    </div>
  ) : (
    <button className="btn-ghost-sm" onClick={startEdit}>
      <Icon name="wrench" size={13} /> Modifica
    </button>
  );

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
            {editButtons}
          </div>
          <dl className="kv">
            <div><dt>ID Fascicolo</dt><dd className="mono">{machine.code}</dd></div>
            <div>
              <dt>Tipologia impianto</dt>
              <dd>
                {edit ? (
                  <select
                    className="input"
                    value={form.plantType}
                    onChange={(e) => {
                      const pt = e.target.value;
                      setForm((s) => ({
                        ...s,
                        plantType: pt,
                        model: modelsFor(pt)[0],
                        customModel: "",
                      }));
                    }}
                  >
                    {(plantNames.includes(form.plantType) || !form.plantType
                      ? plantNames
                      : [form.plantType, ...plantNames]
                    ).map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                ) : (
                  machine.plantType || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Modello</dt>
              <dd>
                {edit ? (
                  <>
                    <select
                      className="input"
                      value={form.model}
                      onChange={(e) => setFF("model", e.target.value)}
                    >
                      {modelsFor(form.plantType).map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    {form.model === CUSTOM_MODEL && (
                      <input
                        className="input"
                        style={{ marginTop: 6 }}
                        value={form.customModel}
                        placeholder="Modello personalizzato"
                        onChange={(e) => setFF("customModel", e.target.value)}
                      />
                    )}
                  </>
                ) : (
                  machine.model
                )}
              </dd>
            </div>
            <div>
              <dt>Job Number (commessa di vendita)</dt>
              <dd className="mono">
                {edit ? (
                  <input
                    className="input mono"
                    value={form.job}
                    onChange={(e) => setFF("job", e.target.value)}
                  />
                ) : (
                  machine.job
                )}
              </dd>
            </div>
            <div>
              <dt>Job Body (corpo trituratore)</dt>
              <dd className="mono">
                {edit ? (
                  <input
                    className="input mono"
                    value={form.jobBody}
                    placeholder="—"
                    onChange={(e) => setFF("jobBody", e.target.value)}
                  />
                ) : (
                  machine.jobBody || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Job Container (container)</dt>
              <dd className="mono">
                {edit ? (
                  <input
                    className="input mono"
                    value={form.jobContainer}
                    placeholder="—"
                    onChange={(e) => setFF("jobContainer", e.target.value)}
                  />
                ) : (
                  machine.jobContainer || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Anno</dt>
              <dd>
                {edit ? (
                  <input
                    className="input mono"
                    type="number"
                    value={form.year}
                    onChange={(e) => setFF("year", e.target.value)}
                  />
                ) : (
                  machine.year
                )}
              </dd>
            </div>
          </dl>
        </section>
        <section className="card">
          <div className="card-header">
            <h3>Cliente e destinazione</h3>
            {editButtons}
          </div>
          <dl className="kv">
            <div>
              <dt>Cliente</dt>
              <dd>
                {edit ? (
                  <>
                    <CustomerPicker currentName={form.customer || null} onPick={pickCustomer} />
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {form.customerId
                        ? "Collegato all'anagrafica clienti."
                        : "Non collegato: scegli il cliente dall'elenco perché la macchina compaia tra le sue."}
                    </div>
                  </>
                ) : (
                  <>
                    {machine.customer}
                    {!machine.customerId && (
                      <span className="muted small" style={{ marginLeft: 6 }}>
                        (non collegato all'anagrafica)
                      </span>
                    )}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Paese</dt>
              <dd>
                {edit ? (
                  <select
                    className="input"
                    value={form.countryCode}
                    onChange={(e) => setFF("countryCode", e.target.value)}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  machine.country
                )}
              </dd>
            </div>
            <div>
              <dt>Sito</dt>
              <dd>
                {edit ? (
                  <>
                    {sites.length > 0 && (
                      <select
                        className="input"
                        style={{ marginBottom: 6 }}
                        value={sites.some((x) => x.name === form.site) ? form.site : ""}
                        onChange={(e) => setFF("site", e.target.value)}
                      >
                        <option value="">— Cantiere del cliente / altro —</option>
                        {sites.map((x) => (
                          <option key={x.id} value={x.name}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      className="input"
                      value={form.site}
                      placeholder="—"
                      onChange={(e) => setFF("site", e.target.value)}
                    />
                  </>
                ) : (
                  machine.site || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Inizio produzione</dt>
              <dd>
                {edit ? (
                  <input
                    className="input"
                    type="date"
                    value={form.productionStart}
                    onChange={(e) => setFF("productionStart", e.target.value)}
                  />
                ) : (
                  fmtDate(machine.productionStart)
                )}
              </dd>
            </div>
            <div>
              <dt>Data consegna</dt>
              <dd>
                {edit ? (
                  <input
                    className="input"
                    type="date"
                    value={form.deliveryDate}
                    onChange={(e) => setFF("deliveryDate", e.target.value)}
                  />
                ) : (
                  fmtDate(machine.deliveryDate)
                )}
              </dd>
            </div>
          </dl>
        </section>

        <ErpCard machine={machine} canEdit={canEdit} onDone={onDone} notify={notify} />

        <section className="card">
          <div className="card-header">
            <h3>Targa tecnica</h3>
            {editButtons}
          </div>
          <dl className="kv">
            <div>
              <dt>Peso</dt>
              <dd>
                {edit ? (
                  <input
                    className="input"
                    value={form.plateWeight}
                    placeholder="38 500 kg"
                    onChange={(e) => setFF("plateWeight", e.target.value)}
                  />
                ) : (
                  machine.plateWeight || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Potenza nominale</dt>
              <dd>
                {edit ? (
                  <input
                    className="input"
                    value={form.platePower}
                    placeholder="450 kW"
                    onChange={(e) => setFF("platePower", e.target.value)}
                  />
                ) : (
                  machine.platePower || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Tensione / Frequenza</dt>
              <dd>
                {edit ? (
                  <select
                    className="input"
                    value={form.plateVoltage}
                    onChange={(e) => setFF("plateVoltage", e.target.value)}
                  >
                    <option value="">—</option>
                    {[
                      "400V / 50Hz",
                      "480V / 60Hz",
                      "690V / 50Hz",
                      "380V / 50Hz",
                      ...(form.plateVoltage &&
                      ![
                        "400V / 50Hz",
                        "480V / 60Hz",
                        "690V / 50Hz",
                        "380V / 50Hz",
                      ].includes(form.plateVoltage)
                        ? [form.plateVoltage]
                        : []),
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  machine.plateVoltage || "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Settaggi pressione</dt>
              <dd className="mono">
                {edit ? (
                  <input
                    className="input mono"
                    value={form.pressureSettings}
                    placeholder="255 bar + 3/4 giro (320 bar)"
                    onChange={(e) => setFF("pressureSettings", e.target.value)}
                  />
                ) : (
                  machine.pressureSettings || "—"
                )}
              </dd>
            </div>
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
                  {d.hint && (
                    <div className="muted small" style={{ fontWeight: 400 }}>
                      {d.hint}
                    </div>
                  )}
                </dt>
                <dd>
                  {editMs && !msAuto(d.key) ? (
                    <input
                      className="input"
                      type="date"
                      value={ms[d.key] || ""}
                      onChange={(e) => setMs((s) => ({ ...s, [d.key]: e.target.value }))}
                    />
                  ) : ms[d.key] ? (
                    <>
                      <span className="mono">{fmtDate(ms[d.key])}</span>
                      {msOrigin(d.key) && (
                        <span className="muted small" style={{ marginLeft: 8 }}>
                          {msOrigin(d.key)}
                          {editMs && msAuto(d.key) ? " · automatica" : ""}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">— da definire</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="muted small" style={{ marginTop: 10 }}>
            Le date automatiche (gestionale, check list di collaudo, intervento di
            installazione) prevalgono e si correggono alla fonte; «Modifica date»
            completa a mano quelle mancanti.
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

/**
 * Vista dei dati gestionale SALVATI sul fascicolo (ultima sincronizzazione),
 * usata quando la connessione diretta al SQL Server non è disponibile — cioè in
 * produzione sulla VPS, dove i dati arrivano dal sync-agent on-premise.
 */
function SyncedErpFallback({
  machine,
  reason,
}: {
  machine: Machine;
  reason: string | null;
}) {
  const prodEnd = machine.milestones?.find((m) => m.key === "production_end")?.date ?? null;
  const prodStart =
    machine.productionStart ??
    machine.milestones?.find((m) => m.key === "production_start")?.date ??
    null;
  const hasAny =
    machine.erpSyncedAt || machine.erpDescription || machine.erpHours || prodStart;

  if (!hasAny) {
    return (
      <p className="muted small">
        Nessun dato dal gestionale per questo fascicolo.
        {reason ? ` (${reason})` : ""}
      </p>
    );
  }

  const fmtH = (h: number | null) =>
    h && h > 0 ? `${h.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h` : "—";

  return (
    <>
      <div className="info-banner" style={{ marginBottom: 12 }}>
        <Icon name="clock" size={15} />
        <span>
          Dati sincronizzati dal gestionale
          {machine.erpSyncedAt ? ` il ${fmtDate(machine.erpSyncedAt)}` : ""}. La
          connessione diretta non è attiva su questo server (aggiornamento via sync-agent).
        </span>
      </div>
      <dl className="kv">
        {machine.erpDescription && (
          <div>
            <dt>Descrizione commessa</dt>
            <dd>{machine.erpDescription}</dd>
          </div>
        )}
        <div>
          <dt>Cliente (gestionale)</dt>
          <dd>{machine.customer || <span className="muted">—</span>}</dd>
        </div>
        <div>
          <dt>Inizio produzione (gestionale)</dt>
          <dd className="mono">
            {prodStart ? fmtDate(prodStart) : <span className="muted">— nessuna timbratura</span>}
          </dd>
        </div>
        <div>
          <dt>Fine produzione (gestionale)</dt>
          <dd className="mono">
            {prodEnd ? fmtDate(prodEnd) : <span className="muted">— in corso / assente</span>}
          </dd>
        </div>
        <div>
          <dt>Ore di lavorazione totali</dt>
          <dd className="mono">{fmtH(machine.erpHours)}</dd>
        </div>
      </dl>
    </>
  );
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

      {/* In produzione (VPS) la connessione diretta al gestionale non c'è: i dati
          arrivano dal sync-agent e restano salvati sul fascicolo. Mostriamo QUELLI
          invece di lasciare la card vuota. */}
      {(state === "unavailable" || state === "error") && (
        <SyncedErpFallback machine={machine} reason={state === "error" ? errMsg : null} />
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

              <div className="table-wrap">
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
              </div>

              {/* Ordini di produzione: quando una parte è sulla commessa generica
                  999999999 (impianto nuovo) va scelto l'ordine. Il Corpo mostra
                  la tendina se jobBody è generico, il Container se jobContainer è
                  generico; cavalletto/lame sono accessori sotto la commessa
                  generica e restano sempre selezionabili se c'è una parte generica. */}
              {(isGenericCommessa(machine.jobBody) ||
                isGenericCommessa(machine.jobContainer)) && (
                <div style={{ marginTop: 14 }}>
                  <div className="muted small" style={{ fontWeight: 600, marginBottom: 6 }}>
                    Ordini di produzione (impianto nuovo, commessa 999999999)
                  </div>
                  {isGenericCommessa(machine.jobBody) && (
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
                  )}
                  {isGenericCommessa(machine.jobContainer) && (
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
                  )}
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
                  <div className="table-wrap">
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
  canEdit,
  canSign,
  canManageOptions,
  hasSavedSignature,
  onReplace,
  onDone,
  notify,
}: {
  machine: Machine;
  canEdit?: boolean;
  canSign?: boolean;
  canManageOptions?: boolean;
  hasSavedSignature?: boolean;
  onReplace?: (c: { groupId: string; itemId: string; itemLabel: string; oldSerial: string }) => void;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  // BLUE DEVIL: i componenti si compilano solo nelle schede M5.16 / M5.17. Le
  // altre tipologie restano sull'elenco per gruppo finché non avranno le loro.
  const sheetsMode = hasAllestimentoSheets(machine.plantType);
  const view: "schede" | "elenco" = sheetsMode ? "schede" : "elenco";
  const [open, setOpen] = useState<string | null>(machine.components[0]?.groupId ?? null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const totalSerials = machine.components.reduce(
    (a, c) => a + c.items.filter((i) => i.serial).length,
    0
  );

  // gruppi custom = quelli non presenti nel catalogo
  const customComps = machine.components.filter(
    (c) => !COMPONENT_GROUPS.some((g) => g.id === c.groupId)
  );

  async function addField(componentId: string, label: string) {
    const res = await fetch(`/api/machines/${machine.id}/component-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ componentId, label }),
    });
    if (res.ok) {
      onDone();
      notify("Campo aggiunto");
    } else notify("Errore", "err");
  }
  async function deleteField(itemId: string) {
    const res = await fetch(`/api/machines/${machine.id}/component-item?itemId=${itemId}`, { method: "DELETE" });
    if (res.ok) {
      onDone();
      notify("Campo rimosso");
    } else notify("Errore", "err");
  }
  async function deleteComponent(componentId: string) {
    if (!confirm("Eliminare questo componente personalizzato e tutti i suoi campi?")) return;
    const res = await fetch(`/api/machines/${machine.id}/component?componentId=${componentId}`, { method: "DELETE" });
    if (res.ok) {
      onDone();
      notify("Componente eliminato");
    } else notify("Errore", "err");
  }

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

  // Foto per slot: le foto arrivano ordinate dalla più recente, quindi la
  // prima incontrata è la miniatura da mostrare.
  const photoByItem = new Map<string, { path: string; takenAt: string; authorName: string | null; count: number }>();
  machine.photos.forEach((p) => {
    if (!p.componentItemId) return;
    const cur = photoByItem.get(p.componentItemId);
    if (cur) cur.count += 1;
    else photoByItem.set(p.componentItemId, { path: p.path, takenAt: p.takenAt, authorName: p.authorName, count: 1 });
  });

  function photoCell(itemId: string, title: string) {
    const ph = photoByItem.get(itemId);
    const pick = () => {
      setTarget(itemId);
      setTimeout(() => photoRef.current?.click(), 0);
    };
    if (!ph)
      return (
        <button className="thumb-empty" title={title} onClick={pick}>
          <Icon name="camera" size={16} />
        </button>
      );
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <a
          href={ph.path}
          target="_blank"
          rel="noreferrer"
          title={`Apri foto · ${fmtDate(ph.takenAt)} · ${ph.authorName ?? "—"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb-photo" src={ph.path} alt={title} />
        </a>
        {ph.count > 1 && <span className="muted small mono">+{ph.count - 1}</span>}
        <button className="icon-btn sm" title="Aggiungi un'altra foto" onClick={pick}>
          <Icon name="camera" size={14} />
        </button>
      </div>
    );
  }

  // Kit tirante giunto (solo BLUE DEVIL): spunta con aggiornamento immediato
  const [tirante, setTirante] = useState(machine.tiranteGiunto);
  const [kitBusy, setKitBusy] = useState(false);
  useEffect(() => setTirante(machine.tiranteGiunto), [machine.tiranteGiunto]);
  async function toggleTirante(v: boolean) {
    setTirante(v);
    setKitBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/kit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiranteGiunto: v }),
    });
    setKitBusy(false);
    if (res.ok) {
      onDone();
      notify(v ? "Tirante giunto: montato" : "Tirante giunto: non montato");
    } else {
      setTirante(!v);
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore salvataggio kit", "err");
    }
  }

  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="cmp-summary">
          <span className="muted">Gruppi tracciati:</span>{" "}
          <strong>{machine.components.length}</strong>
          <span className="dot-sep"> · </span>
          <span className="muted">Matricole censite:</span> <strong>{totalSerials}</strong>
        </div>
        <div className="cmp-actions">
          {canEdit && (
            <button className="btn-primary-sm" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={14} /> Aggiungi componente
            </button>
          )}
        </div>
      </div>

      {hasTiranteGiunto(machine.plantType) && (
        <section className="card" style={{ marginBottom: 12, padding: "12px 16px" }}>
          <label
            style={{ display: "flex", alignItems: "center", gap: 12, cursor: canEdit ? "pointer" : "default" }}
          >
            <input
              type="checkbox"
              checked={tirante}
              disabled={!canEdit || kitBusy}
              onChange={(e) => toggleTirante(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
            />
            <span>
              <strong>Tirante giunto</strong>
              <span className="muted small" style={{ display: "block" }}>
                Spunta se questa macchina monta il kit tirante giunto.
              </span>
            </span>
          </label>
        </section>
      )}

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => uploadItemPhoto(e.target.files)}
      />

      {sheetsMode && view === "schede" && (
        <AllestimentoSheets
          machine={machine}
          canEdit={!!canEdit}
          canSign={!!canSign}
          canManageOptions={!!canManageOptions}
          hasSavedSignature={!!hasSavedSignature}
          renderSerial={(it) => (
            <SlotSerialCell machineId={machine.id} item={it} canEdit={!!canEdit} onDone={onDone} notify={notify} />
          )}
          renderPhoto={photoCell}
          onDone={onDone}
          notify={notify}
        />
      )}

      {sheetsMode && view === "schede" && customComps.length > 0 && (
        <h3 className="al-custom-title">Componenti personalizzati</h3>
      )}

      <div className="cmp-list">
        {COMPONENT_GROUPS.map((g) => {
          const c = machine.components.find((x) => x.groupId === g.id);
          if (!c || view === "schede") return null;
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
                            <td>
                              <SlotSerialCell
                                machineId={machine.id}
                                item={it}
                                canEdit={!!canEdit}
                                onDone={onDone}
                                notify={notify}
                              />
                            </td>
                            <td>
                              {photoCell(it.id, `${g.label} — ${it.label}`)}
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

        {/* Componenti personalizzati (custom) */}
        {customComps.map((c) => {
          const isOpen = open === c.groupId;
          const filled = c.items.filter((i) => i.serial).length;
          return (
            <div key={c.groupId} className={"cmp-row" + (isOpen ? " open" : "")}>
              <button className="cmp-row-head" onClick={() => setOpen(isOpen ? null : c.groupId)}>
                <span className="cmp-icon">
                  <Icon name="box" size={20} />
                </span>
                <div className="cmp-name">
                  <div className="cmp-label">{c.label || "Componente"}</div>
                  <div className="cmp-en mono">PERSONALIZZATO</div>
                </div>
                <div className="cmp-brand">{c.brand || "—"}</div>
                <div className="cmp-count">
                  <span className={"cmp-count-pill " + (filled === c.items.length && filled > 0 ? "full" : filled > 0 ? "partial" : "")}>
                    {filled} / {c.items.length}
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
                          <th>Campo</th>
                          <th>Matricola / Valore</th>
                          <th>Foto</th>
                          {canEdit && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {c.items.map((it) => (
                          <tr key={it.id}>
                            <td>{it.label}</td>
                            <td>
                              <SlotSerialCell machineId={machine.id} item={it} canEdit={!!canEdit} onDone={onDone} notify={notify} />
                            </td>
                            <td>
                              {photoCell(it.id, `${c.label || "Componente"} — ${it.label}`)}
                            </td>
                            {canEdit && (
                              <td>
                                <button className="icon-btn sm" title="Rimuovi campo" onClick={() => deleteField(it.id)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {canEdit && (
                    <div className="cmp-custom-actions">
                      <button
                        className="btn-ghost-sm"
                        onClick={() => {
                          const l = prompt("Nome del nuovo campo (es. Sensore, Valvola…)");
                          if (l && l.trim()) addField(c.id, l.trim());
                        }}
                      >
                        <Icon name="plus" size={13} /> Aggiungi campo
                      </button>
                      <button className="btn-ghost-sm danger" onClick={() => deleteComponent(c.id)}>
                        <Icon name="trash" size={13} /> Elimina componente
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {addOpen && (
        <AddComponentModal
          machineId={machine.id}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            onDone();
            notify("Componente creato");
          }}
        />
      )}
    </div>
  );
}

/* Modale: crea un componente personalizzato con i suoi campi */
function AddComponentModal({
  machineId,
  onClose,
  onDone,
}: {
  machineId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [fields, setFields] = useState<string[]>(["Matricola"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setField = (i: number, v: string) => setFields((s) => s.map((x, idx) => (idx === i ? v : x)));
  const addField = () => setFields((s) => [...s, ""]);
  const delField = (i: number) => setFields((s) => s.filter((_, idx) => idx !== i));

  async function save() {
    if (!label.trim()) {
      setErr("Inserisci il nome del componente.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/machines/${machineId}/component`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, brand, fields: fields.map((f) => f.trim()).filter(Boolean) }),
    });
    setBusy(false);
    if (res.ok) onDone();
    else {
      const d = await res.json().catch(() => null);
      setErr(d?.error ?? "Errore nel salvataggio.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nuovo componente</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Nome componente *</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Es. Sensore di prossimità" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Marca / Fornitore</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Es. SICK" />
          </label>
          <div className="field">
            <span className="field-label">Campi da compilare</span>
            {fields.map((f, i) => (
              <div key={i} className="slot-serial" style={{ marginBottom: 6 }}>
                <input value={f} onChange={(e) => setField(i, e.target.value)} placeholder={`Campo ${i + 1}`} style={{ flex: 1 }} />
                {fields.length > 1 && (
                  <button className="icon-btn sm" onClick={() => delField(i)} aria-label="Rimuovi">
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            ))}
            <button className="btn-ghost-sm" onClick={addField} style={{ marginTop: 4 }}>
              <Icon name="plus" size={13} /> Aggiungi campo
            </button>
          </div>
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Salvataggio…" : "Crea componente"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Cella matricola: inline-editabile + lettura da foto (OCR) da tablet/telefono */
// Matricole lette/digitate ma non ancora salvate, per slot. Stanno fuori dal
// componente: dopo l'upload della foto la pagina si aggiorna e lo stato locale
// della cella andava perso, facendo sparire la proposta dell'OCR.
const pendingSerials = new Map<string, string>();

function SlotSerialCell({
  machineId,
  item,
  canEdit,
  onDone,
  notify,
}: {
  machineId: string;
  item: Item;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [val, setValState] = useState(() => pendingSerials.get(item.id) ?? item.serial ?? "");
  const [busy, setBusy] = useState<null | "save" | "ocr">(null);
  const camRef = useRef<HTMLInputElement>(null);
  const dirty = val.trim() !== (item.serial ?? "");

  function setVal(v: string) {
    pendingSerials.set(item.id, v);
    setValState(v);
  }

  async function persist(serial: string): Promise<boolean> {
    const res = await fetch(`/api/machines/${machineId}/component-item`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, serial }),
    });
    if (res.ok) pendingSerials.delete(item.id);
    return res.ok;
  }

  async function save() {
    setBusy("save");
    try {
      if (await persist(val)) {
        onDone();
        notify("Matricola salvata");
      } else notify("Errore salvataggio matricola", "err");
    } finally {
      setBusy(null);
    }
  }

  async function fromPhoto(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    setBusy("ocr");
    try {
      // OCR (su copia ridotta) e salvataggio della foto originale sullo slot in
      // parallelo. Il valore letto si mostra solo DOPO l'upload, e resta in
      // pendingSerials: il refresh che segue non deve cancellare la proposta.
      const fd = new FormData();
      fd.append("photo", await downscaleImage(file));
      const fd2 = new FormData();
      fd2.append("photos", file);
      fd2.append("category", "componente");
      fd2.append("componentItemId", item.id);
      const [res, up] = await Promise.all([
        fetch("/api/vision/serial", { method: "POST", body: fd }),
        fetch(`/api/machines/${machineId}/photos`, { method: "POST", body: fd2 }).catch(() => null),
      ]);
      const d = await res.json().catch(() => null);
      if (!up?.ok) notify("Foto non salvata sullo slot", "err");
      const serial: string = res.ok ? d?.serial ?? "" : "";
      const current = item.serial ?? "";
      if (!serial) {
        notify(d?.error || "Matricola non riconosciuta nella foto: inseriscila a mano", "err");
      } else if (serial === current) {
        notify(`Matricola ${serial} confermata dalla foto`);
      } else if (!current && d?.confidence !== "low") {
        // Slot vuoto e lettura sicura: si salva subito (prima restava una
        // proposta da confermare con ✓ e nessuno la confermava). Resta
        // correggibile, e la correzione va a diario come ogni modifica.
        setVal(serial);
        if (await persist(serial)) notify(`Matricola ${serial} letta e salvata — controlla che sia giusta`);
        else notify("Matricola letta ma non salvata: premi ✓", "err");
      } else {
        // Slot già compilato con un altro valore, o lettura incerta: non si
        // sovrascrive da solo, decide l'operatore.
        setVal(serial);
        notify(
          current
            ? `Letta ${serial}, diversa da quella salvata (${current}): premi ✓ per sostituirla`
            : `Letta ${serial} ma con poca sicurezza: controlla e premi ✓ per salvarla`,
          "err"
        );
      }
      onDone();
    } finally {
      setBusy(null);
    }
  }

  if (!canEdit) return <span className="mono">{item.serial || <span className="muted">—</span>}</span>;

  return (
    <div className="slot-serial">
      <input
        className={"mono" + (dirty ? " unsaved" : "")}
        title={dirty ? "Non ancora salvata: premi ✓" : undefined}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="matricola…"
      />
      <button
        type="button"
        className="icon-btn sm"
        title="Leggi matricola da foto"
        onClick={() => camRef.current?.click()}
        disabled={busy !== null}
      >
        <Icon name="camera" size={15} />
      </button>
      {dirty && (
        <button
          type="button"
          className="icon-btn sm slot-save"
          title="Salva matricola"
          onClick={save}
          disabled={busy !== null}
        >
          <Icon name="check" size={15} />
        </button>
      )}
      {busy === "ocr" && <span className="muted small">lettura…</span>}
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => fromPhoto(e.target.files)}
      />
    </div>
  );
}

/* ── Tab Foto: cartelle ─────────────────────────────────── */
type PhotoItem = Machine["photos"][number];
type FolderId = "componenti" | "produzione" | "collaudo" | "interventi" | "cestino";

/** Colore della cartella: c = tinta (striscia, icona), text = testo/contatore,
 *  bg = fondo tenue della linguetta. */
type FolderColor = { c: string; text: string; bg: string };

const FOLDER_COLORS: Record<FolderId, FolderColor> = {
  componenti: { c: "#10b981", text: "#0a7d52", bg: "#10b9811a" }, // verde
  produzione: { c: "#2f6aed", text: "#1f4fbf", bg: "#2f6aed14" }, // blu ZATO
  collaudo: { c: "#8b5cf6", text: "#6d28d9", bg: "#8b5cf61a" }, // viola
  interventi: { c: "#f59e0b", text: "#b45309", bg: "#f59e0b1f" }, // giallo
  cestino: { c: "#94a3b8", text: "#475569", bg: "#94a3b81f" }, // grigio
};

const FOLDERS: { id: FolderId; label: string; hint: string; manual: boolean }[] = [
  {
    id: "componenti",
    label: "Componenti",
    hint: "Arrivano in automatico dalle foto caricate in Componenti & Matricole.",
    manual: false,
  },
  { id: "produzione", label: "Produzione", hint: "Foto di produzione caricate a mano.", manual: true },
  { id: "collaudo", label: "Collaudo", hint: "Foto di collaudo caricate a mano.", manual: true },
  {
    id: "interventi",
    label: "Interventi",
    hint: "Una cartella per intervento: le foto di rapportini, chat e diario confluiscono qui in automatico.",
    manual: false,
  },
  {
    id: "cestino",
    label: "Cestino",
    hint: "Foto eliminate: si ripristinano tornando nella cartella d'origine. Eliminazioni e ripristini restano nel diario macchina.",
    manual: false,
  },
];

const folderStyle = (id: FolderId) =>
  ({
    "--folder-c": FOLDER_COLORS[id].c,
    "--folder-text": FOLDER_COLORS[id].text,
    "--folder-bg": FOLDER_COLORS[id].bg,
  }) as React.CSSProperties;

/** In quale cartella va una foto. Le vecchie categorie telaio/idraulica/
 *  elettrico/finiture restano visibili sotto Produzione. */
function folderOf(p: PhotoItem): FolderId {
  if (p.componentItemId || p.category === "componente") return "componenti";
  if (p.interventoId || p.category === "intervento" || p.category === "chat") return "interventi";
  if (p.category === "collaudo") return "collaudo";
  return "produzione";
}

type SubFolder = { key: string; label: string; sub: string; rank: number; photos: PhotoItem[] };

/** Sottocartelle degli interventi: una per intervento di service (INT-…),
 *  poi quelle registrate dal diario del fascicolo, poi le foto orfane. */
function interventoFolders(photos: PhotoItem[]): SubFolder[] {
  const map = new Map<string, SubFolder>();
  for (const p of photos) {
    let f: Omit<SubFolder, "photos">;
    if (p.interventoId)
      f = { key: "int:" + p.interventoId, label: p.interventoCode ?? "Intervento", sub: p.interventoTitle ?? "", rank: 0 };
    else if (p.diaryEventId)
      f = { key: "diary:" + p.diaryEventId, label: "Diario · " + fmtDate(p.diaryDate), sub: p.diaryTitle ?? "", rank: 1 };
    else f = { key: "other", label: "Senza intervento", sub: "Foto non collegate a un intervento", rank: 2 };
    if (!map.has(f.key)) map.set(f.key, { ...f, photos: [] });
    map.get(f.key)!.photos.push(p);
  }
  return [...map.values()].sort(
    (a, b) => a.rank - b.rank || b.label.localeCompare(a.label, "it", { numeric: true })
  );
}

function FolderCard({
  label,
  sub,
  photos,
  color,
  onOpen,
}: {
  label: string;
  sub?: string;
  photos: PhotoItem[];
  color: FolderId;
  onOpen: () => void;
}) {
  const cover = photos[0];
  return (
    <button type="button" className="folder-card" style={folderStyle(color)} onClick={onOpen}>
      <div className="folder-cover">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.path} alt={label} />
        ) : (
          <Icon name="folder" size={34} />
        )}
      </div>
      <div className="folder-info">
        <Icon name="folder" size={16} color="var(--folder-c)" />
        <span className="folder-name">{label}</span>
        <span className="folder-count">{photos.length}</span>
      </div>
      {sub ? <div className="folder-sub">{sub}</div> : null}
    </button>
  );
}

function TabFoto({
  machine,
  userId,
  canEdit,
  onDone,
  notify,
}: {
  machine: Machine;
  userId: string;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [folder, setFolder] = useState<FolderId | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function removePhoto(p: PhotoItem) {
    if (!confirm("Eliminare questa foto? L'eliminazione resta annotata nel diario macchina.")) return;
    setDeleting(p.id);
    try {
      const res = await fetch(`/api/machines/${machine.id}/photos/${p.id}`, { method: "DELETE" });
      if (res.ok) {
        onDone();
        notify("Foto eliminata — annotato a diario");
      } else {
        const d = await res.json().catch(() => ({}));
        notify(d.error || "Errore eliminazione foto", "err");
      }
    } finally {
      setDeleting(null);
    }
  }

  async function restorePhoto(p: PhotoItem) {
    setDeleting(p.id);
    try {
      const res = await fetch(`/api/machines/${machine.id}/photos/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (res.ok) {
        onDone();
        notify("Foto ripristinata — annotato a diario");
      } else {
        const d = await res.json().catch(() => ({}));
        notify(d.error || "Errore ripristino foto", "err");
      }
    } finally {
      setDeleting(null);
    }
  }

  const byFolder: Record<FolderId, PhotoItem[]> = {
    componenti: [],
    produzione: [],
    collaudo: [],
    interventi: [],
    cestino: machine.photoTrash,
  };
  for (const p of machine.photos) byFolder[folderOf(p)].push(p);
  const inTrash = folder === "cestino";

  const current = folder ? FOLDERS.find((f) => f.id === folder)! : null;
  const subs = folder === "interventi" ? interventoFolders(byFolder.interventi) : [];
  const subFolder = sub ? subs.find((s) => s.key === sub) ?? null : null;
  // nella cartella Interventi le foto si vedono solo dentro una sottocartella
  const photos = subFolder ? subFolder.photos : folder && folder !== "interventi" ? byFolder[folder] : [];

  async function upload(files: FileList | null) {
    if (!files || !files.length || !current?.manual) return;
    setBusy(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("photos", f));
    fd.append("category", current.id);
    const res = await fetch(`/api/machines/${machine.id}/photos`, { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) {
      onDone();
      notify(`Foto caricate in ${current.label}`);
    } else notify("Errore upload", "err");
  }

  function photoTitle(p: PhotoItem) {
    if (folder === "componenti") return p.componentLabel ?? p.caption ?? "Componente";
    if (folder === "cestino") {
      const origin = FOLDERS.find((f) => f.id === folderOf(p))!.label;
      const detail = p.componentLabel ?? p.interventoCode ?? p.caption;
      return detail ? `${origin} · ${detail}` : origin;
    }
    return p.caption || (current?.label ?? p.category);
  }

  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="folder-crumb" style={folder ? folderStyle(folder) : undefined}>
          <Icon name="folder" size={15} color={folder ? "var(--folder-c)" : "var(--muted)"} />
          {folder ? (
            <button
              onClick={() => {
                setFolder(null);
                setSub(null);
              }}
            >
              Foto
            </button>
          ) : (
            <strong>Foto</strong>
          )}
          {current && (
            <>
              <span className="muted">›</span>
              {subFolder ? (
                <button onClick={() => setSub(null)}>{current.label}</button>
              ) : (
                <strong style={{ color: "var(--folder-text)" }}>{current.label}</strong>
              )}
            </>
          )}
          {subFolder && (
            <>
              <span className="muted">›</span>
              <strong style={{ color: "var(--folder-text)" }}>{subFolder.label}</strong>
            </>
          )}
          <span className="muted small" style={{ marginLeft: 6 }}>
            {folder ? `${subFolder ? subFolder.photos.length : byFolder[folder].length} foto` : `${machine.photos.length} foto`}
          </span>
        </div>
        {current?.manual && (
          <div className="cmp-actions">
            <button className="btn-primary-sm" disabled={busy} onClick={() => camRef.current?.click()}>
              <Icon name="camera" size={14} /> Scatta foto
            </button>
            <button className="btn-ghost-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="image" size={14} /> Dalla libreria
            </button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files)} />
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
        )}
      </div>

      {current && (
        <p className="muted small" style={{ margin: "-4px 0 12px" }}>
          {current.hint}
        </p>
      )}

      {!folder && (
        <div className="folder-grid">
          {FOLDERS.map((f) => (
            <FolderCard
              key={f.id}
              label={f.label}
              sub={f.manual ? "Caricamento manuale" : "Automatica"}
              photos={byFolder[f.id]}
              color={f.id}
              onOpen={() => {
                setFolder(f.id);
                setSub(null);
              }}
            />
          ))}
        </div>
      )}

      {folder === "interventi" && !subFolder && (
        subs.length ? (
          <div className="folder-grid">
            {subs.map((s) => (
              <FolderCard
                key={s.key}
                label={s.label}
                sub={s.sub}
                photos={s.photos}
                color="interventi"
                onOpen={() => setSub(s.key)}
              />
            ))}
          </div>
        ) : (
          <div className="card empty-state">Nessuna foto di intervento per questa macchina.</div>
        )
      )}

      {folder && (folder !== "interventi" || subFolder) && (
        photos.length === 0 ? (
          current?.manual ? (
            <div className="upload-zone" onClick={() => fileRef.current?.click()}>
              <Icon name="camera" size={26} />
              <div>Cartella vuota — clicca per caricare le foto</div>
            </div>
          ) : (
            <div className="card empty-state">Cartella vuota.</div>
          )
        ) : (
          <div className="photo-grid">
            {photos.map((p) => (
              <figure key={p.id} className="photo-card">
                <a href={p.path} target="_blank" rel="noreferrer" title="Apri la foto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.path} alt={photoTitle(p)} />
                </a>
                {!inTrash && (canEdit || (!!p.authorId && p.authorId === userId)) && (
                  <button
                    type="button"
                    className="photo-del"
                    title="Elimina foto"
                    disabled={deleting !== null}
                    onClick={() => removePhoto(p)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
                <figcaption>
                  <div className="photo-title">{photoTitle(p)}</div>
                  <div className="photo-meta mono">
                    {fmtDate(p.takenAt)} · {p.authorName || "—"}
                  </div>
                  {inTrash && (
                    <>
                      <div className="photo-meta">
                        Eliminata da {p.deletedByName || "—"} il {fmtDateTime(p.deletedAt)}
                      </div>
                      {(canEdit || (!!p.authorId && p.authorId === userId)) && (
                        <button
                          type="button"
                          className="btn-ghost-sm"
                          style={{ marginTop: 8 }}
                          disabled={deleting !== null}
                          onClick={() => restorePhoto(p)}
                        >
                          <Icon name="arrow-left" size={13} /> Ripristina
                        </button>
                      )}
                    </>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )
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

function checklistProgress(
  answers: Record<string, { value: string | null; note?: string }>,
  items: ChecklistItem[]
) {
  let done = 0;
  for (const it of items) {
    const a = answers[String(it.n)];
    if (a && (a.value === "SI" || a.value === "NO" || a.value === "NA")) done++;
  }
  return { done, total: items.length };
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
  // La check list dipende dalla tipologia: M5.7 per cesoie e spaccabinari.
  const cl = checklistFor(machine.plantType);
  const { done, total } = checklistProgress(c?.answers || {}, cl.items);
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
                {cl.title.charAt(0) + cl.title.slice(1).toLowerCase()} ({cl.code})
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
            <div className="form-grid" style={{ marginBottom: 12 }}>
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
        note: `Data ${def.label.toLowerCase()} — ${m.detail ?? (SOURCE_LABEL[m.source] ?? m.source).toLowerCase()}.`,
        date: m.date,
        actorName: SOURCE_LABEL[m.source] ?? m.source,
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
/* ── Note macchina: appunti firmati, modificabili ma non cancellabili ── */
function TabNote({
  machine,
  currentUserId,
  canAdd,
  canEditAll,
  onDone,
  notify,
}: {
  machine: Machine;
  currentUserId: string;
  canAdd: boolean;
  canEditAll: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [q, setQ] = useState("");
  const [trash, setTrash] = useState(false);

  const active = machine.notesLog.filter((n) => !n.deletedAt);
  const deleted = machine.notesLog
    .filter((n) => n.deletedAt)
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  const shown = trash ? deleted : active;
  const notes = shown.filter(
    (n) =>
      !q.trim() ||
      n.text.toLowerCase().includes(q.toLowerCase()) ||
      n.authorName.toLowerCase().includes(q.toLowerCase())
  );

  async function removeNote(id: string) {
    if (!confirm("Spostare la nota nel cestino? Potrai ripristinarla dal Cestino.")) return;
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/notes/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      onDone();
      notify("Nota spostata nel cestino");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore cancellazione nota", "err");
    }
  }

  async function restoreNote(id: string) {
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: true }),
    });
    setBusy(false);
    if (res.ok) {
      onDone();
      notify("Nota ripristinata");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore ripristino nota", "err");
    }
  }

  async function add() {
    if (!draft.trim()) return notify("Scrivi il testo della nota", "err");
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: draft }),
    });
    setBusy(false);
    if (res.ok) {
      setDraft("");
      onDone();
      notify("Nota aggiunta");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore salvataggio nota", "err");
    }
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return notify("La nota non può restare vuota", "err");
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: editText }),
    });
    setBusy(false);
    if (res.ok) {
      setEditId(null);
      onDone();
      notify("Nota aggiornata");
    } else {
      const d = await res.json().catch(() => ({}));
      notify(d.error || "Errore modifica nota", "err");
    }
  }

  return (
    <div className="tab-content">
      {canAdd && !trash && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3>Nuova nota</h3>
          </div>
          <p className="muted small" style={{ marginBottom: 8 }}>
            Settaggi particolari, aggiustaggi dedicati, accorgimenti da ricordare. La nota viene
            firmata con il tuo nome, data e ora; si potrà correggere, e cancellandola finisce nel Cestino, da cui si recupera.
          </p>
          <textarea
            className="input"
            rows={4}
            value={draft}
            placeholder="es. Pressione di taglio portata a 270 bar per materiale misto…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-primary-sm" disabled={busy || !draft.trim()} onClick={add}>
              <Icon name="plus" size={13} /> Aggiungi nota
            </button>
          </div>
        </section>
      )}

      <div className="cmp-toolbar">
        <div className="filters">
          <button
            className={"chip-btn" + (!trash ? " active" : "")}
            onClick={() => {
              setTrash(false);
              setEditId(null);
            }}
          >
            Note <span className="chip-n">{active.length}</span>
          </button>
          <button
            className={"chip-btn" + (trash ? " active" : "")}
            onClick={() => {
              setTrash(true);
              setEditId(null);
            }}
          >
            <Icon name="trash" size={12} /> Cestino <span className="chip-n">{deleted.length}</span>
          </button>
        </div>
        {shown.length > 3 && (
          <div className="search" style={{ maxWidth: 280 }}>
            <Icon name="search" size={15} color="var(--muted)" />
            <input placeholder="Cerca nelle note…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>

      {notes.length === 0 && (
        <div className="card empty-state">
          {shown.length > 0
            ? "Nessuna nota trovata."
            : trash
            ? "Il cestino è vuoto."
            : "Nessuna nota per questa macchina."}
        </div>
      )}

      {notes.map((n) => {
        const mayEdit = canEditAll || (!!n.authorId && n.authorId === currentUserId);
        const editing = editId === n.id;
        return (
          <section className="card" key={n.id} style={{ marginBottom: 12 }}>
            <div className="card-header" style={{ alignItems: "flex-start" }}>
              <div>
                <strong>{n.authorName}</strong>
                <div className="muted small mono">{fmtDateTime(n.createdAt)}</div>
              </div>
              {mayEdit && !editing && !trash && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn-ghost-sm"
                    onClick={() => {
                      setEditId(n.id);
                      setEditText(n.text);
                    }}
                  >
                    <Icon name="sign" size={13} /> Modifica
                  </button>
                  <button
                    className="btn-ghost-sm danger"
                    disabled={busy}
                    onClick={() => removeNote(n.id)}
                  >
                    <Icon name="trash" size={13} /> Elimina
                  </button>
                </div>
              )}
              {mayEdit && trash && (
                <button className="btn-ghost-sm" disabled={busy} onClick={() => restoreNote(n.id)}>
                  <Icon name="arrow-left" size={13} /> Ripristina
                </button>
              )}
            </div>
            {editing ? (
              <>
                <textarea
                  className="input"
                  rows={Math.min(12, Math.max(4, n.text.split("\n").length + 1))}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
                  <button className="btn-ghost-sm" onClick={() => setEditId(null)}>
                    Annulla
                  </button>
                  <button className="btn-primary-sm" disabled={busy} onClick={() => saveEdit(n.id)}>
                    <Icon name="check" size={13} /> Salva
                  </button>
                </div>
              </>
            ) : (
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                  color: trash ? "var(--text-2)" : undefined,
                }}
              >
                {n.text}
              </div>
            )}
            {n.deletedAt && (
              <div className="muted small" style={{ marginTop: 10 }}>
                <Icon name="trash" size={11} /> Eliminata da <strong>{n.deletedByName}</strong> il{" "}
                {fmtDateTime(n.deletedAt)}
              </div>
            )}
            {n.editedAt && (
              <div className="muted small" style={{ marginTop: 10 }}>
                Modificata da <strong>{n.editedByName}</strong> il {fmtDateTime(n.editedAt)}
                {n.revisions.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: "pointer" }}>
                      Versioni precedenti ({n.revisions.length})
                    </summary>
                    {n.revisions.map((r) => (
                      <div
                        key={r.id}
                        style={{ borderLeft: "3px solid var(--border)", padding: "4px 10px", marginTop: 8 }}
                      >
                        <div className="mono">
                          sostituita il {fmtDateTime(r.editedAt)} da {r.editedByName}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", color: "var(--text-2)", marginTop: 3 }}>
                          {r.text}
                        </div>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

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
  const cl = checklistFor(machine.plantType);
  const items = cl.items;

  // Hydrate answers from collaudo (or empty)
  const [answers, setAnswers] = useState<AnsMap>(() => {
    const out: AnsMap = {};
    for (const it of items) {
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

  const done = items.reduce((n, it) => n + (answers[String(it.n)].value ? 1 : 0), 0);
  const total = items.length;
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
            {cl.title} — {cl.code} ({total} voci)
          </div>

          {items.map((it, idx) => {
            const a = answers[String(it.n)];
            // testata di sezione (la M5.7 raggruppa i controlli)
            const newSection = it.section && it.section !== items[idx - 1]?.section;
            return (
              <div
                key={it.n}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px dashed var(--border)",
                }}
              >
                {newSection && (
                  <div
                    className="small"
                    style={{
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: "var(--navy)",
                      margin: "4px 0 10px",
                    }}
                  >
                    {it.section}
                  </div>
                )}
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
