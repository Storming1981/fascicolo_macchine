"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

/**
 * Pannello di conversazione con lo ZATO Brain.
 *
 * Usato sia dalla Knowledge interna sia dal portale cliente (`endpoint` diverso,
 * `variant` diverso): la logica di streaming e di rendering è la stessa, cambiano
 * le affordance (allegati e feedback solo all'interno).
 */

export type BrainSource = {
  sourceId: string;
  title: string;
  type: string;
  breadcrumb: string;
  page: number | null;
  videoAt: number | null;
  filePath: string | null;
  videoUrl: string | null;
  score: number;
};

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: BrainSource[];
  images?: string[];
  rating?: number | null;
  pending?: boolean;
  error?: string;
  stats?: { costUsd: number; latencyMs: number; cacheReadTokens: number } | null;
};

/** Una conversazione salvata: le domande restano, cambiare pagina non le perde. */
type Thread = { id: string; title: string; updatedAt: string; messages: number };

const TYPE_LABEL: Record<string, string> = {
  MANUAL: "Manuale",
  PROCEDURE: "Procedura",
  CASE: "Caso risolto",
  DRAWING: "Disegno",
  VIDEO: "Video",
  BULLETIN: "Bollettino",
  SPARE: "Ricambi",
  ARTICLE: "Articolo",
  RAPPORTINO: "Rapportino",
  CHAT: "Chat cantiere",
  DIARY: "Diario macchina",
  OTHER: "Documento",
};

const SUGGESTIONS_INTERNAL = [
  "Come si sostituiscono i martelli di un BLUE DEVIL?",
  "Il rotore si blocca sotto carico: da dove parto?",
  "Quali problemi si ripetono più spesso sulle cesoie CAYMAN?",
  "Procedura di messa in sicurezza prima di entrare in tramoggia",
];
const SUGGESTIONS_PORTAL = [
  "Ogni quante ore va fatta la manutenzione programmata?",
  "Come si pulisce lo scambiatore dell'olio idraulico?",
  "Cosa devo controllare se l'impianto si ferma in allarme?",
];

export default function BrainChat({
  endpoint = "/api/brain/ask",
  threadsEndpoint = "/api/brain/threads",
  variant = "internal",
  configured = true,
  machineId,
  context,
  compact = false,
}: {
  endpoint?: string;
  /** Base delle API per elenco/dettaglio delle conversazioni salvate. */
  threadsEndpoint?: string;
  variant?: "internal" | "portal";
  configured?: boolean;
  machineId?: string;
  context?: string;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [images, setImages] = useState<{ mediaType: string; data: string; preview: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const internal = variant === "internal";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const loadThreads = useCallback(async (): Promise<Thread[]> => {
    try {
      const r = await fetch(threadsEndpoint);
      if (!r.ok) return [];
      const d = await r.json();
      const list: Thread[] = d.threads ?? [];
      setThreads(list);
      return list;
    } catch {
      return [];
    }
  }, [threadsEndpoint]);

  /** Rilegge una conversazione dal database e la rimette a schermo com'era. */
  const openThread = useCallback(
    async (id: string) => {
      setShowHistory(false);
      try {
        const r = await fetch(`${threadsEndpoint}/${id}`);
        if (!r.ok) return;
        const d = await r.json();
        const msgs: Msg[] = (d.thread?.messages ?? []).map(
          (m: {
            id: string;
            role: string;
            content: string;
            sources?: BrainSource[];
            images?: string[];
            rating?: number | null;
            model?: string | null;
            latencyMs?: number;
          }) => ({
            id: m.id,
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
            sources: Array.isArray(m.sources) ? m.sources : [],
            images: Array.isArray(m.images) ? m.images : [],
            rating: m.rating ?? null,
          })
        );
        setMessages(msgs);
        setThreadId(id);
      } catch {
        /* se non si riesce a rileggerla si resta su quella corrente */
      }
    },
    [threadsEndpoint]
  );

  // All'avvio si riprende l'ultima conversazione: chi va a cercare un dato e
  // torna sulla pagina deve ritrovare quello che aveva chiesto, non una schermata
  // vuota da cui ricominciare.
  useEffect(() => {
    if (!configured) {
      setRestoring(false);
      return;
    }
    let annullato = false;
    (async () => {
      const list = await loadThreads();
      if (!annullato && list.length > 0) await openThread(list[0].id);
      if (!annullato) setRestoring(false);
    })();
    return () => {
      annullato = true;
    };
  }, [configured, loadThreads, openThread]);

  function newThread() {
    setMessages([]);
    setThreadId(null);
    setShowHistory(false);
    setStatus("");
  }

  async function deleteThread(id: string) {
    if (!confirm("Eliminare questa conversazione?")) return;
    await fetch(`${threadsEndpoint}/${id}`, { method: "DELETE" }).catch(() => {});
    const list = await loadThreads();
    if (threadId === id) {
      if (list.length > 0) await openThread(list[0].id);
      else newThread();
    }
  }

  const addImages = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const next: { mediaType: string; data: string; preview: string }[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      if (!file.type.startsWith("image/")) continue;
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const data = btoa(bin);
      next.push({ mediaType: file.type, data, preview: `data:${file.type};base64,${data}` });
    }
    setImages((cur) => [...cur, ...next].slice(0, 4));
  }, []);

  async function send(text?: string) {
    const question = (text ?? draft).trim();
    if (!question || busy) return;

    const userMsg: Msg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question,
      images: images.map((i) => i.preview),
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: assistantId, role: "assistant", content: "", pending: true }]);
    setDraft("");
    setBusy(true);
    setStatus("Interpreto la domanda…");

    const payload = {
      question,
      threadId,
      machineId,
      context,
      images: internal ? images.map((i) => ({ mediaType: i.mediaType, data: i.data })) : undefined,
    };
    setImages([]);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Errore ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          applyEvent(ev, assistantId);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Errore di rete";
      setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, pending: false, error: message } : x)));
    } finally {
      setBusy(false);
      setStatus("");
      void loadThreads(); // una domanda nuova crea (o rinomina) la conversazione
    }
  }

  function applyEvent(ev: Record<string, unknown>, assistantId: string) {
    const type = ev.type as string;
    if (type === "thread") {
      if (typeof ev.id === "string") setThreadId(ev.id);
      if (typeof ev.messageId === "string") {
        const realId = ev.messageId;
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, id: realId } : x)));
      }
      return;
    }
    if (type === "status") {
      setStatus(String(ev.message ?? ""));
      return;
    }
    if (type === "sources") {
      const sources = ev.sources as BrainSource[];
      setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, sources } : x)));
      return;
    }
    if (type === "text") {
      setStatus("");
      setMessages((m) =>
        m.map((x) => (x.id === assistantId ? { ...x, content: x.content + String(ev.delta ?? ""), pending: false } : x))
      );
      return;
    }
    if (type === "done") {
      const usage = ev.usage as { cacheReadTokens?: number } | undefined;
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? {
                ...x,
                pending: false,
                stats: {
                  costUsd: Number(ev.costUsd ?? 0),
                  latencyMs: Number(ev.latencyMs ?? 0),
                  cacheReadTokens: Number(usage?.cacheReadTokens ?? 0),
                },
              }
            : x
        )
      );
      return;
    }
    if (type === "error") {
      setMessages((m) =>
        m.map((x) => (x.id === assistantId ? { ...x, pending: false, error: String(ev.message ?? "Errore") } : x))
      );
    }
  }

  async function rate(id: string, rating: number) {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, rating } : x)));
    await fetch(`/api/brain/messages/${id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    }).catch(() => {});
  }

  const suggestions = internal ? SUGGESTIONS_INTERNAL : SUGGESTIONS_PORTAL;

  if (!configured) {
    return (
      <div className="card empty-state">
        <Icon name="doc" size={22} color="var(--muted)" />
        <p style={{ marginTop: 8 }}>
          ZATO Brain non è configurato. Imposta <code>ANTHROPIC_API_KEY</code> nel file <code>.env</code> del
          server per attivare l&apos;assistente.
        </p>
      </div>
    );
  }

  const current = threads.find((t) => t.id === threadId);

  return (
    <div className={"brain" + (compact ? " brain-compact" : "")}>
      <div className="brain-topbar">
        <button
          className={"brain-histbtn" + (showHistory ? " on" : "")}
          onClick={() => setShowHistory((o) => !o)}
          title="Conversazioni salvate"
        >
          <Icon name="clock" size={15} />
          Conversazioni
          {threads.length > 0 && <span className="brain-count">{threads.length}</span>}
        </button>
        <span className="brain-current">{current?.title ?? "Nuova domanda"}</span>
        <button className="brain-newbtn" onClick={newThread} disabled={busy}>
          <Icon name="plus" size={14} /> Nuova
        </button>
      </div>

      <div className="brain-body">
        {showHistory && (
          <aside className="brain-history">
            {threads.length === 0 ? (
              <p className="brain-history-empty">
                Nessuna conversazione salvata. Le domande che fai restano qui.
              </p>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  className={"brain-histitem" + (t.id === threadId ? " active" : "")}
                >
                  <button onClick={() => void openThread(t.id)}>
                    <span className="brain-histitem-title">{t.title}</span>
                    <span className="brain-histitem-meta">
                      {new Date(t.updatedAt).toLocaleDateString("it-IT", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                      })}
                      {" · "}
                      {Math.ceil(t.messages / 2)} domand{Math.ceil(t.messages / 2) === 1 ? "a" : "e"}
                    </span>
                  </button>
                  <button
                    className="brain-histdel"
                    onClick={() => void deleteThread(t.id)}
                    aria-label="Elimina conversazione"
                    title="Elimina"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))
            )}
          </aside>
        )}

      <div className="brain-main">
      <div className="brain-stream" ref={scrollRef}>
        {restoring && messages.length === 0 && (
          <div className="brain-welcome">
            <p>Recupero le tue conversazioni…</p>
          </div>
        )}
        {!restoring && messages.length === 0 && (
          <div className="brain-welcome">
            <div className="brain-badge">
              <Icon name="doc" size={18} color="var(--accent)" />
            </div>
            <h3>Chiedi allo ZATO Brain</h3>
            <p>
              Risponde su manuali, procedure, guasti e ricambi degli impianti ZATO, citando i documenti
              da cui prende ogni informazione.
              {internal && " Puoi allegare la foto di un guasto o di un disegno tecnico."}
            </p>
            <div className="brain-suggestions">
              {suggestions.map((s) => (
                <button key={s} className="brain-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={"brain-msg brain-" + m.role}>
            {m.role === "assistant" && (
              <div className="brain-avatar">
                <Icon name="doc" size={14} color="#fff" />
              </div>
            )}
            <div className="brain-bubble">
              {m.images && m.images.length > 0 && (
                <div className="brain-imgs">
                  {m.images.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt="allegato" />
                  ))}
                </div>
              )}

              {m.error ? (
                <div className="brain-error">
                  <Icon name="x" size={14} /> {m.error}
                </div>
              ) : m.pending && !m.content ? (
                <div className="brain-typing">
                  <span />
                  <span />
                  <span />
                  {status && <em>{status}</em>}
                </div>
              ) : (
                <Markdown text={m.content} />
              )}

              {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                <Sources sources={m.sources} />
              )}

              {m.role === "assistant" && !m.pending && !m.error && internal && (
                <div className="brain-foot">
                  <button
                    className={"brain-rate" + (m.rating === 1 ? " on" : "")}
                    onClick={() => rate(m.id, 1)}
                    title="Risposta utile"
                  >
                    <Icon name="check" size={13} /> Utile
                  </button>
                  <button
                    className={"brain-rate" + (m.rating === -1 ? " on" : "")}
                    onClick={() => rate(m.id, -1)}
                    title="Risposta non utile — segnala una lacuna nella knowledge base"
                  >
                    <Icon name="flag" size={13} /> Non utile
                  </button>
                  {m.stats && (
                    <span className="brain-stats" title="Costo stimato della richiesta">
                      {m.stats.latencyMs > 0 && `${(m.stats.latencyMs / 1000).toFixed(1)}s`}
                      {m.stats.costUsd > 0 && ` · $${m.stats.costUsd.toFixed(4)}`}
                      {m.stats.cacheReadTokens > 0 && " · cache ✓"}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="brain-composer">
        {images.length > 0 && (
          <div className="brain-attachments">
            {images.map((img, i) => (
              <div key={i} className="brain-attachment">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.preview} alt="" />
                <button onClick={() => setImages((c) => c.filter((_, j) => j !== i))} aria-label="Rimuovi">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="brain-input">
          {internal && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addImages(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                className="brain-attach"
                onClick={() => fileRef.current?.click()}
                title="Allega foto o disegno tecnico"
                disabled={busy}
              >
                <Icon name="camera" size={16} />
              </button>
            </>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              internal
                ? "Descrivi il problema o fai una domanda tecnica…"
                : "Scrivi la tua domanda sull'impianto…"
            }
            rows={1}
            disabled={busy}
          />
          <button className="btn-primary brain-send" onClick={() => void send()} disabled={busy || !draft.trim()}>
            {busy ? "…" : <Icon name="arrow-right" size={15} />}
          </button>
        </div>
        <div className="brain-disclaimer">
          Le risposte sono generate dall&apos;AI sui documenti ZATO. Verifica sempre sul manuale prima di
          operare sull&apos;impianto.
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Fonti citate ───────────────────────── */

function Sources({ sources }: { sources: BrainSource[] }) {
  const [open, setOpen] = useState(false);
  // Una riga per documento, non per frammento: il tecnico ragiona per documenti.
  const byDoc = new Map<string, BrainSource[]>();
  for (const s of sources) {
    const arr = byDoc.get(s.sourceId) ?? [];
    arr.push(s);
    byDoc.set(s.sourceId, arr);
  }
  const docs = [...byDoc.values()];

  return (
    <div className="brain-sources">
      <button className="brain-sources-toggle" onClick={() => setOpen((o) => !o)}>
        <Icon name="doc" size={13} /> {docs.length} font{docs.length === 1 ? "e" : "i"} consultat
        {docs.length === 1 ? "a" : "e"}
        <Icon name={open ? "chev-down" : "chev-right"} size={13} />
      </button>
      {open && (
        <ul className="brain-sources-list">
          {docs.map((group) => {
            const s = group[0];
            const pages = group.map((g) => g.page).filter((p): p is number => p != null);
            const href = s.videoUrl ?? (s.filePath ? `${s.filePath}${pages[0] ? `#page=${pages[0]}` : ""}` : null);
            const body = (
              <>
                <span className="brain-source-type">{TYPE_LABEL[s.type] ?? s.type}</span>
                <span className="brain-source-title">{s.title}</span>
                {pages.length > 0 && (
                  <span className="brain-source-page">
                    p. {[...new Set(pages)].sort((a, b) => a - b).join(", ")}
                  </span>
                )}
                {s.videoAt != null && (
                  <span className="brain-source-page">
                    {Math.floor(s.videoAt / 60)}:{String(s.videoAt % 60).padStart(2, "0")}
                  </span>
                )}
              </>
            );
            return (
              <li key={s.sourceId}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {body}
                  </a>
                ) : (
                  <span>{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────── Markdown minimale ───────────────────────── */

/**
 * Il modello risponde in markdown semplice (titoli, elenchi, grassetto, codice).
 * Bastano poche regole per renderlo leggibile senza tirarsi in casa una libreria.
 */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = Math.min(6, h[1].length + 2);
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) {
      if (list !== "ol") {
        closeList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inline(ol[2])}</li>`);
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ul) {
      if (list !== "ul") {
        closeList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();

  return <div className="brain-md" dangerouslySetInnerHTML={{ __html: html.join("") }} />;
}
