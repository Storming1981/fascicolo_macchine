"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import BrainChat from "@/components/BrainChat";
import { INTERVENTO_STATUS_META } from "@/lib/domain";
import type { InterventoStatus } from "@prisma/client";

type Item = {
  id: string;
  code: string;
  title: string;
  status: InterventoStatus;
  site: string | null;
  machine: string | null;
  chatId: string | null;
  publicMessages: number;
};
type Msg = {
  id: string;
  direction: "IN" | "OUT";
  authorName: string;
  body: string | null;
  photoPath: string | null;
  sentAt: string;
};

export default function PortaleClient({ brainConfigured = false }: { brainConfigured?: boolean }) {
  const [mode, setMode] = useState<"interventi" | "brain">("interventi");
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<Item | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const msgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/portale/interventi")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function openChat(it: Item) {
    setSel(it);
    setMessages([]);
    if (!it.chatId) return;
    const r = await fetch(`/api/portale/chat/${it.chatId}/messages`);
    const d = await r.json().catch(() => null);
    if (r.ok) setMessages(d.messages ?? []);
  }

  useEffect(() => {
    if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight;
  }, [messages]);

  async function deleteMsg(msgId: string) {
    if (!sel?.chatId || !confirm("Eliminare questo messaggio?")) return;
    const r = await fetch(`/api/portale/chat/${sel.chatId}/messages/${msgId}`, { method: "DELETE" });
    if (r.ok) {
      const d = await fetch(`/api/portale/chat/${sel.chatId}/messages`).then((x) => x.json());
      setMessages(d.messages ?? []);
    }
  }

  async function send() {
    if (!draft.trim() || !sel?.chatId) return;
    setSending(true);
    try {
      const r = await fetch(`/api/portale/chat/${sel.chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (r.ok) {
        setDraft("");
        const d2 = await fetch(`/api/portale/chat/${sel.chatId}/messages`).then((x) => x.json());
        setMessages(d2.messages ?? []);
      }
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="portal-empty">Caricamento…</div>;

  return (
    <>
      <InstallHint />

      <div className="kb-tabs portal-tabs">
        <button
          className={"kb-tab" + (mode === "interventi" ? " active" : "")}
          onClick={() => setMode("interventi")}
        >
          <Icon name="wrench" size={15} /> I tuoi interventi
        </button>
        <button className={"kb-tab" + (mode === "brain" ? " active" : "")} onClick={() => setMode("brain")}>
          <Icon name="boost" size={15} /> Assistenza tecnica
        </button>
      </div>

      {mode === "brain" ? (
        <BrainChat endpoint="/api/portale/brain" variant="portal" configured={brainConfigured} />
      ) : (
    <div className="portal-grid">
      <aside className="portal-list">
        <h2>I tuoi interventi</h2>
        {items.length === 0 && <div className="portal-empty small">Nessun intervento.</div>}
        {items.map((it) => {
          const st = INTERVENTO_STATUS_META[it.status];
          return (
            <button
              key={it.id}
              className={"portal-item" + (sel?.id === it.id ? " active" : "")}
              onClick={() => openChat(it)}
            >
              <div className="portal-item-top">
                <span className="mono muted">{it.code}</span>
                <span className="status-chip" style={{ background: st.color + "22", color: st.color }}>
                  {st.label}
                </span>
              </div>
              <div className="portal-item-title">{it.title}</div>
              <div className="portal-item-meta">
                {it.machine && <span className="mono">{it.machine}</span>}
                {it.site && <span> · {it.site}</span>}
              </div>
            </button>
          );
        })}
      </aside>

      <section className="portal-chat">
        {!sel ? (
          <div className="portal-empty">Seleziona un intervento per vedere la conversazione.</div>
        ) : (
          <>
            <div className="portal-chat-head">
              <span className="mono muted">{sel.code}</span> {sel.title}
            </div>
            <div className="portal-messages" ref={msgRef}>
              {messages.length === 0 && (
                <div className="portal-empty small">Ancora nessun messaggio. Scrivici pure qui sotto.</div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={"pmsg " + (m.direction === "OUT" ? "zato" : "me")}>
                  <div className="pmsg-author">
                    {m.direction === "OUT" ? "ZATO Service" : m.authorName}
                    {m.direction === "IN" && (
                      <button className="msg-del" onClick={() => deleteMsg(m.id)} aria-label="Elimina">
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </div>
                  {m.body && <div className="pmsg-body">{m.body}</div>}
                  {m.photoPath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={m.photoPath} target="_blank" rel="noreferrer">
                      <img className="pmsg-photo" src={m.photoPath} alt="allegato" />
                    </a>
                  )}
                  <div className="pmsg-time mono">
                    {new Date(m.sentAt).toLocaleString("it-IT", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="portal-composer">
              <textarea
                rows={1}
                placeholder="Scrivi un messaggio a ZATO…"
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
                Invia
              </button>
            </div>
          </>
        )}
      </section>
    </div>
      )}
    </>
  );
}

/** Suggerimento discreto per installare il portale come app (persistente). */
function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        (navigator as unknown as { standalone?: boolean }).standalone;
      if (!standalone && !localStorage.getItem("portal-install-dismissed")) setShow(true);
    } catch {
      /* no-op */
    }
  }, []);
  if (!show) return null;
  return (
    <div className="portal-install">
      <span>
        💡 Aggiungi <strong>ZATO Service</strong> alla schermata Home per usarlo come app.
      </span>
      <button
        onClick={() => {
          try {
            localStorage.setItem("portal-install-dismissed", "1");
          } catch {
            /* no-op */
          }
          setShow(false);
        }}
        aria-label="Chiudi"
      >
        ✕
      </button>
    </div>
  );
}
