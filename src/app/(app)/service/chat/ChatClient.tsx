"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

export type ConversationRow = {
  id: string;
  title: string;
  channel: string;
  contactName: string | null;
  customer: string | null;
  machineCode: string | null;
  interventoCode: string | null;
  messages: number;
  lastMessageAt: string | null;
};
export type LinkOpts = {
  customers: { id: string; name: string; machines: { id: string; code: string; job: string; model: string }[] }[];
  interventi: { id: string; code: string; title: string; machineId: string | null; customerId: string | null }[];
};
type Msg = {
  id: string;
  direction: "IN" | "OUT";
  authorName: string;
  body: string | null;
  sentAt: string;
  source: string;
};
type ConvDetail = {
  id: string;
  title: string;
  channel: string;
  contactName: string | null;
  customer: { id: string; name: string } | null;
  machine: { id: string; code: string; job: string | null } | null;
  intervento: { id: string; code: string; title: string } | null;
  messages: Msg[];
};

const CHANNEL_LABEL: Record<string, string> = {
  native: "Portale",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};
const CHANNEL_COLOR: Record<string, string> = {
  native: "#2f6aed",
  whatsapp: "#25d366",
  telegram: "#229ED9",
};

function ChannelBadge({ channel }: { channel: string }) {
  const c = CHANNEL_COLOR[channel] ?? "#64748b";
  return (
    <span className="chan-badge" style={{ background: c + "1f", color: c }}>
      {CHANNEL_LABEL[channel] ?? channel}
    </span>
  );
}

export default function ChatClient({
  conversations,
  links,
  currentUserName,
  canSend,
  canImport,
  initialConvId,
}: {
  conversations: ConversationRow[];
  links: LinkOpts;
  currentUserName: string;
  canSend: boolean;
  canImport: boolean;
  initialConvId?: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("tutto");
  const [selId, setSelId] = useState<string | null>(initialConvId ?? conversations[0]?.id ?? null);
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const msgRef = useRef<HTMLDivElement>(null);

  // AI
  type Analysis = { urgency: number; category: string; sentiment: string; summary: string; suggestedReplies: string[]; tags: string[] };
  const [ai, setAi] = useState<Analysis | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  async function analyze() {
    if (!selId) return;
    setAiBusy(true);
    setAiErr(null);
    try {
      const res = await fetch(`/api/chat/${selId}/analyze`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setAiErr(d?.error ?? "Errore analisi.");
        return;
      }
      setAi(d.analysis);
    } finally {
      setAiBusy(false);
    }
  }

  const filtered = conversations.filter((c) => (filter === "tutto" ? true : c.channel === filter));

  async function loadDetail(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/${id}/messages`);
      const d = await res.json().catch(() => null);
      if (res.ok) setDetail(d.conversation);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (selId) loadDetail(selId);
    else setDetail(null);
    setAi(null);
    setAiErr(null);
  }, [selId]);
  useEffect(() => {
    if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight;
  }, [detail]);

  async function send() {
    if (!draft.trim() || !selId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/chat/${selId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (res.ok) {
        setDraft("");
        await loadDetail(selId);
      }
    } finally {
      setSending(false);
    }
  }

  const isNative = detail?.channel === "native";

  return (
    <div className="view chat-view">
      <div className="view-header">
        <div>
          <h1>Chat unificata</h1>
          <p>Portale conversazioni ZATO · storico WhatsApp / Telegram importato</p>
        </div>
        <div className="flex-inline" style={{ gap: 8 }}>
          {canImport && (
            <button className="btn-ghost" onClick={() => setShowImport(true)}>
              <Icon name="upload" size={15} /> Importa storico
            </button>
          )}
          {canSend && (
            <button className="btn-primary" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={15} /> Nuova conversazione
            </button>
          )}
        </div>
      </div>

      <div className="chat-shell">
        {/* INBOX */}
        <div className="chat-inbox">
          <div className="inbox-tabs">
            {[
              ["tutto", "Tutto"],
              ["native", "Portale"],
              ["whatsapp", "WhatsApp"],
              ["telegram", "Telegram"],
            ].map(([k, l]) => (
              <button
                key={k}
                className={"inbox-tab" + (filter === k ? " active" : "")}
                onClick={() => setFilter(k)}
              >
                {l}
                <span className="mono muted">{conversations.filter((c) => (k === "tutto" ? true : c.channel === k)).length}</span>
              </button>
            ))}
          </div>
          <div className="inbox-list">
            {filtered.map((c) => (
              <button
                key={c.id}
                className={"conv-item" + (c.id === selId ? " active" : "")}
                onClick={() => setSelId(c.id)}
              >
                <div className="conv-top">
                  <span className="conv-name">{c.contactName ?? c.title}</span>
                  <ChannelBadge channel={c.channel} />
                </div>
                <div className="conv-sub muted small">{c.title}</div>
                <div className="conv-meta muted small">
                  {[c.customer, c.machineCode, c.interventoCode].filter(Boolean).join(" · ") || "—"}
                  <span className="mono"> {c.messages} msg</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty-state small">Nessuna conversazione.</div>}
          </div>
        </div>

        {/* THREAD */}
        <div className="chat-thread">
          {!detail ? (
            <div className="empty-state">{loading ? "Caricamento…" : "Seleziona una conversazione."}</div>
          ) : (
            <>
              <div className="thread-head">
                <div>
                  <div style={{ fontWeight: 700 }}>{detail.contactName ?? detail.title}</div>
                  <div className="muted small flex-inline" style={{ gap: 8 }}>
                    <ChannelBadge channel={detail.channel} /> {detail.title}
                  </div>
                </div>
                {canSend && (
                  <button className="btn-ghost-sm" onClick={() => setShowEdit(true)}>
                    <Icon name="sign" size={14} /> Modifica
                  </button>
                )}
              </div>

              <div className="thread-messages" ref={msgRef}>
                {detail.messages.map((m) => (
                  <div key={m.id} className={"msg " + (m.direction === "OUT" ? "out" : "in")}>
                    {m.direction === "IN" && <div className="msg-author">{m.authorName}</div>}
                    {m.body && <div className="msg-body">{m.body}</div>}
                    <div className="msg-time mono">
                      {new Date(m.sentAt).toLocaleString("it-IT", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
                {detail.messages.length === 0 && <div className="empty-state small">Nessun messaggio.</div>}
              </div>

              {isNative && canSend ? (
                <div className="thread-composer">
                  <textarea
                    rows={1}
                    placeholder="Scrivi un messaggio…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button className="btn-primary" onClick={send} disabled={sending || !draft.trim()}>
                    <Icon name="arrow-right" size={15} /> Invia
                  </button>
                </div>
              ) : (
                <div className="thread-readonly muted small">
                  Storico importato — sola lettura
                </div>
              )}
            </>
          )}
        </div>

        {/* CONTEXT */}
        <div className="chat-context">
          <div className="card">
            <div className="card-header"><h3 style={{ fontSize: 13 }}>Contesto</h3></div>
            {!detail ? (
              <div className="muted small">—</div>
            ) : (
              <div className="ctx-list">
                <CtxRow label="Canale" value={CHANNEL_LABEL[detail.channel] ?? detail.channel} />
                {detail.contactName && <CtxRow label="Contatto" value={detail.contactName} />}
                {detail.customer && (
                  <CtxLink label="Cliente" href={null} text={detail.customer.name} />
                )}
                {detail.machine && (
                  <CtxLink
                    label="Macchina"
                    href={`/macchine/${detail.machine.code}`}
                    text={detail.machine.job || detail.machine.code}
                  />
                )}
                {detail.intervento && (
                  <CtxLink
                    label="Intervento"
                    href={`/service/interventi/${detail.intervento.id}`}
                    text={`${detail.intervento.code} · ${detail.intervento.title}`}
                  />
                )}
                {!detail.customer && !detail.machine && !detail.intervento && (
                  <div className="muted small">Nessun aggancio a commessa.</div>
                )}
              </div>
            )}
          </div>

          {detail && (
            <div className="card">
              <div className="card-header">
                <h3 style={{ fontSize: 13 }}>Analisi AI</h3>
                <button className="btn-ghost-sm" onClick={analyze} disabled={aiBusy}>
                  {aiBusy ? "Analizzo…" : ai ? "Rianalizza" : "Analizza"}
                </button>
              </div>
              {aiErr && <div className="muted small">{aiErr}</div>}
              {!ai && !aiErr && !aiBusy && (
                <div className="muted small">
                  Analizza urgenza, categoria, sentiment e risposte suggerite con l&apos;AI.
                </div>
              )}
              {ai && (
                <div className="ai-result">
                  <div className="ai-row">
                    <span className="field-label">Urgenza</span>
                    <span className="mono" style={{ fontWeight: 700, color: ai.urgency > 0.6 ? "#dc2626" : "var(--text)" }}>
                      {Math.round(ai.urgency * 100)}%
                    </span>
                  </div>
                  <div className="urg-bar">
                    <span style={{ width: `${ai.urgency * 100}%`, background: ai.urgency > 0.6 ? "#dc2626" : "var(--accent)" }} />
                  </div>
                  <div className="ai-row">
                    <span className="field-label">Categoria</span>
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{ai.category}</span>
                  </div>
                  <div className="ai-row">
                    <span className="field-label">Sentiment</span>
                    <span className="status-chip" style={{ background: "#f59e0b22", color: "#b45309" }}>{ai.sentiment}</span>
                  </div>
                  {ai.summary && <div className="ai-summary">{ai.summary}</div>}
                  {ai.suggestedReplies.length > 0 && (
                    <div className="ai-replies">
                      <span className="field-label">Risposte suggerite</span>
                      {ai.suggestedReplies.map((r, i) => (
                        <button key={i} className="ai-reply" onClick={() => setDraft(r)} title="Inserisci nel composer">
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                  {ai.tags.length > 0 && (
                    <div className="ai-tags">
                      {ai.tags.map((t) => (
                        <span key={t} className="ai-tag">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewConversationModal links={links} onClose={() => setShowNew(false)} onCreated={(id) => setSelId(id)} />
      )}
      {showImport && (
        <ImportModal links={links} onClose={() => setShowImport(false)} onImported={(id) => setSelId(id)} />
      )}
      {showEdit && detail && (
        <EditConversationModal
          links={links}
          detail={detail}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            loadDetail(detail.id);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ctx-row">
      <span className="field-label">{label}</span>
      <span>{value}</span>
    </div>
  );
}
function CtxLink({ label, href, text }: { label: string; href: string | null; text: string }) {
  return (
    <div className="ctx-row">
      <span className="field-label">{label}</span>
      {href ? (
        <Link href={href} className="link-strong">
          {text}
        </Link>
      ) : (
        <span style={{ fontWeight: 600 }}>{text}</span>
      )}
    </div>
  );
}

/* ---- shared link fields ---- */
function LinkFields({
  links,
  state,
  setState,
}: {
  links: LinkOpts;
  state: { customerId: string; interventoId: string };
  setState: (s: { customerId: string; interventoId: string }) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field-label">Cliente (opzionale)</span>
        <select value={state.customerId} onChange={(e) => setState({ ...state, customerId: e.target.value })}>
          <option value="">—</option>
          {links.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Intervento / commessa (opzionale)</span>
        <select value={state.interventoId} onChange={(e) => setState({ ...state, interventoId: e.target.value })}>
          <option value="">—</option>
          {links.interventi.map((i) => (
            <option key={i.id} value={i.id}>
              {i.code} · {i.title}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function NewConversationModal({
  links,
  onClose,
  onCreated,
}: {
  links: LinkOpts;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [contactName, setContactName] = useState("");
  const [link, setLink] = useState({ customerId: "", interventoId: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) {
      setErr("Inserisci un titolo.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const sel = links.interventi.find((i) => i.id === link.interventoId);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          contactName,
          customerId: link.customerId || sel?.customerId || undefined,
          interventoId: link.interventoId || undefined,
          machineId: sel?.machineId || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore.");
        return;
      }
      const d = await res.json();
      onClose();
      onCreated(d.id);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nuova conversazione</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Titolo *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Es. Guasto mulino M3" />
          </label>
          <label className="field">
            <span className="field-label">Contatto</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome referente cliente" />
          </label>
          <LinkFields links={links} state={link} setState={setLink} />
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "…" : "Crea"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditConversationModal({
  links,
  detail,
  onClose,
  onSaved,
}: {
  links: LinkOpts;
  detail: ConvDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(detail.title);
  const [contactName, setContactName] = useState(detail.contactName ?? "");
  const [customerId, setCustomerId] = useState(detail.customer?.id ?? "");
  const [machineId, setMachineId] = useState(detail.machine?.id ?? "");
  const [interventoId, setInterventoId] = useState(detail.intervento?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customer = links.customers.find((c) => c.id === customerId) ?? null;
  const machines = customer?.machines ?? [];
  const interventiForCustomer = links.interventi.filter(
    (i) => !customerId || i.customerId === customerId
  );

  function onCustomer(id: string) {
    setCustomerId(id);
    setMachineId("");
    setInterventoId("");
  }

  async function save() {
    if (!title.trim()) {
      setErr("Inserisci un titolo.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/chat/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          contactName,
          customerId: customerId || null,
          machineId: machineId || null,
          interventoId: interventoId || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Modifica conversazione</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Titolo *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Contatto</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome referente cliente" />
          </label>
          <label className="field">
            <span className="field-label">Cliente</span>
            <select value={customerId} onChange={(e) => onCustomer(e.target.value)}>
              <option value="">— Nessuno —</option>
              {links.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Macchina {customer ? `(${machines.length})` : ""}</span>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)} disabled={!customer}>
              <option value="">
                {!customer ? "Scegli prima il cliente" : machines.length ? "— Nessuna —" : "Nessuna macchina"}
              </option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.job || m.code} · {m.model}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Intervento collegato</span>
            <select value={interventoId} onChange={(e) => setInterventoId(e.target.value)}>
              <option value="">— Nessuno —</option>
              {interventiForCustomer.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {i.title}
                </option>
              ))}
            </select>
          </label>
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "…" : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({
  links,
  onClose,
  onImported,
}: {
  links: LinkOpts;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<"whatsapp" | "telegram">("whatsapp");
  const [file, setFile] = useState<File | null>(null);
  const [ourName, setOurName] = useState("");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState({ customerId: "", interventoId: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!file) {
      setErr("Seleziona il file di export.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const sel = links.interventi.find((i) => i.id === link.interventoId);
      const fd = new FormData();
      fd.set("file", file);
      fd.set("provider", provider);
      fd.set("ourName", ourName);
      fd.set("title", title);
      if (link.customerId || sel?.customerId) fd.set("customerId", link.customerId || sel!.customerId!);
      if (link.interventoId) fd.set("interventoId", link.interventoId);
      if (sel?.machineId) fd.set("machineId", sel.machineId);
      const res = await fetch("/api/chat/import", { method: "POST", body: fd });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(d?.error ?? "Errore import.");
        return;
      }
      onClose();
      onImported(d.id);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importa storico chat</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as "whatsapp" | "telegram")}>
              <option value="whatsapp">WhatsApp (.txt — &quot;Esporta chat / senza media&quot;)</option>
              <option value="telegram">Telegram (.json — Export chat history)</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">File export *</span>
            <input
              type="file"
              accept={provider === "telegram" ? ".json,application/json" : ".txt,text/plain"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span className="field-label">Il nostro nome nella chat (per distinguere inviati/ricevuti)</span>
            <input value={ourName} onChange={(e) => setOurName(e.target.value)} placeholder="Es. ZATO Service" />
          </label>
          <label className="field">
            <span className="field-label">Titolo (opzionale)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="dedotto dal file se vuoto" />
          </label>
          <LinkFields links={links} state={link} setState={setLink} />
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={run} disabled={saving}>
            {saving ? "Import…" : "Importa"}
          </button>
        </div>
      </div>
    </div>
  );
}
