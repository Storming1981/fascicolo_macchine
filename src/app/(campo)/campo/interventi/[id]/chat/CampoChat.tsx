"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";

type Msg = {
  id: string;
  direction: "IN" | "OUT";
  visibility?: "INTERNAL" | "PUBLIC";
  authorId?: string | null;
  authorName: string;
  body: string | null;
  photoPath?: string | null;
  sentAt: string;
};

export default function CampoChat({
  interventoId,
  code,
  title,
  convId,
  canSend,
  currentUserId,
  isAdmin = false,
}: {
  interventoId: string;
  code: string;
  title: string;
  convId: string | null;
  canSend: boolean;
  currentUserId: string;
  isAdmin?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [toClient, setToClient] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  async function load() {
    if (!convId) {
      setLoading(false);
      return;
    }
    const r = await fetch(`/api/chat/${convId}/messages`);
    const d = await r.json().catch(() => null);
    if (r.ok) setMessages(d.conversation?.messages ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function deleteMsg(msgId: string) {
    if (!convId || !confirm("Eliminare questo messaggio?")) return;
    const r = await fetch(`/api/chat/${convId}/messages/${msgId}`, { method: "DELETE" });
    if (r.ok) await load();
  }

  async function send() {
    if ((!draft.trim() && !photo) || !convId) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.set("body", draft);
      fd.set("visibility", toClient ? "PUBLIC" : "INTERNAL");
      if (photo) fd.set("photo", photo);
      const r = await fetch(`/api/chat/${convId}/messages`, { method: "POST", body: fd });
      if (r.ok) {
        setDraft("");
        setPhoto(null);
        await load();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="campo-view campo-chatview">
      <Link href={`/campo/interventi/${interventoId}`} className="campo-back">
        <Icon name="arrow-left" size={16} /> Intervento
      </Link>
      <div className="campo-head">
        <h1>Chat</h1>
        <p>
          <span className="mono">{code}</span> · {title}
        </p>
      </div>

      {!convId ? (
        <div className="campo-empty">Chat non disponibile per questo intervento.</div>
      ) : (
        <>
          <div className="campo-msgs" ref={listRef}>
            {loading && <div className="campo-empty small">Caricamento…</div>}
            {!loading && messages.length === 0 && (
              <div className="campo-empty small">Nessun messaggio.</div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  "cmsg " + (m.direction === "OUT" ? "out" : "in") +
                  (m.visibility === "PUBLIC" ? "" : " internal")
                }
              >
                <div className="cmsg-top">
                  <span className="cmsg-author">{m.authorName}</span>
                  <span className={"vis-badge " + (m.visibility === "PUBLIC" ? "pub" : "int")}>
                    {m.visibility === "PUBLIC" ? "Cliente" : "Interno"}
                  </span>
                  {(m.authorId === currentUserId || isAdmin) && (
                    <button className="msg-del" onClick={() => deleteMsg(m.id)} aria-label="Elimina">
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                {m.body && <div className="cmsg-body">{m.body}</div>}
                {m.photoPath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={m.photoPath} target="_blank" rel="noreferrer">
                    <img className="cmsg-photo" src={m.photoPath} alt="allegato" />
                  </a>
                )}
                <div className="cmsg-time mono">
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

          {canSend && (
            <div className="campo-composer">
              <div className="composer-toolbar">
                <label className={"vis-toggle" + (toClient ? " on" : "")}>
                  <input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} />
                  {toClient ? "Visibile al cliente" : "Interno ZATO"}
                </label>
                <label className="btn-ghost-sm" style={{ cursor: "pointer" }}>
                  <Icon name="camera" size={13} /> {photo ? "1 foto" : "Foto"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
                {photo && (
                  <button className="btn-ghost-sm" onClick={() => setPhoto(null)}>
                    <Icon name="x" size={13} /> togli
                  </button>
                )}
              </div>
              <div className="campo-composer-row">
                <textarea
                  rows={1}
                  placeholder={toClient ? "Messaggio al cliente…" : "Nota interna…"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="btn-primary"
                  onClick={send}
                  disabled={sending || (!draft.trim() && !photo)}
                >
                  <Icon name="arrow-right" size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
