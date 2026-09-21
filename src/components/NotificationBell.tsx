"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import {
  getPushState,
  enablePush,
  disablePush,
  testPush,
  type PushState,
} from "@/lib/pushClient";

/**
 * Campanella con pallino rosso e numerino, più il pannello delle notifiche.
 *
 * Vive in entrambi i gusci (desktop e Campo): il capo cantiere sta sul tablet,
 * quindi la notifica deve esserci anche lì, e la destinazione del clic cambia
 * (`/service/interventi/...` contro `/campo/interventi/...`).
 *
 * Il numerino finisce anche sull'icona dell'app installata via Badging API,
 * quando il sistema la supporta: è quello che l'utente vede senza aprire nulla.
 */

type Notif = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tone: string;
  icon: string;
  href: string | null;
  interventoId: string | null;
  read: boolean;
  actorName: string | null;
  createdAt: string;
  needsAck: boolean;
};

const TONE: Record<string, string> = {
  alert: "#dc2626",
  warn: "#f59e0b",
  ok: "#10b981",
  info: "#2f6aed",
};

/** "3 min fa", "2 ore fa", "ieri" — in un pannello la data intera non serve. */
function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "ora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ieri";
  if (d < 30) return `${d} giorni fa`;
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Badge sull'icona dell'app installata (PWA). Silenzioso dove non c'è. */
function setAppBadge(n: number) {
  type BadgeNav = Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  const nav = navigator as BadgeNav;
  try {
    if (n > 0) void nav.setAppBadge?.(n)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* non supportato: resta il pallino dentro l'app */
  }
}

export default function NotificationBell({
  variant = "desktop",
}: {
  variant?: "desktop" | "campo";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [acking, setAcking] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications?count=1", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { unread: number };
      setUnread(d.unread);
      setAppBadge(d.unread);
    } catch {
      /* offline in cantiere: si riprova al giro dopo */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { items: Notif[]; unread: number };
      setItems(d.items);
      setUnread(d.unread);
      setAppBadge(d.unread);
    } catch {
      /* idem */
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling: in cantiere non c'è un canale push, quindi si chiede ogni tanto.
  // Solo a scheda visibile, per non tenere sveglia la radio del tablet.
  useEffect(() => {
    void loadCount();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadCount();
    }, 45_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void loadCount();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [loadCount]);

  // Chiusura col clic fuori
  useEffect(() => {
    if (!open) return;
    // pointerdown, non mousedown: sul tablet il tocco deve chiudere il pannello
    // subito, senza aspettare l'evento mouse emulato.
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      void loadList();
      // Lo stato del push si guarda solo all'apertura del pannello: registrare
      // il service worker a ogni caricamento di pagina non serve a nulla.
      if (push === null) void getPushState().then((s) => setPush(s.state));
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (push === "on") {
        await disablePush();
        setPush("off");
        setPushMsg("Notifiche disattivate su questo dispositivo.");
      } else {
        const r = await enablePush();
        setPush(r.state);
        setPushMsg(
          r.ok ? "Attive: provo a mandarti una notifica…" : r.error ?? "Attivazione non riuscita."
        );
        if (r.ok) {
          const sent = await testPush();
          setPushMsg(
            sent
              ? "Fatto: se hai visto la notifica di prova, sei a posto."
              : "Iscritto, ma la prova non è arrivata: riprova fra poco."
          );
        }
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function markRead(ids?: string[]) {
    const body = ids?.length ? { ids } : { all: true };
    setItems((prev) =>
      prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))
    );
    try {
      const r = await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const d = (await r.json()) as { unread: number };
        setUnread(d.unread);
        setAppBadge(d.unread);
      }
    } catch {
      void loadCount();
    }
  }

  /**
   * Presa in carico dalla campanella: e' li' che l'avviso arriva, quindi e' li'
   * che deve poter essere accettato. Farlo aprire l'intervento per rispondere
   * significherebbe che molti non rispondono.
   */
  async function ack(n: Notif, accept: boolean) {
    if (!n.interventoId) return;
    const note = accept
      ? null
      : (window.prompt("Perche' non puoi andarci? (facoltativo)") ?? "").trim() || null;
    setAcking(n.id);
    try {
      const r = await fetch(`/api/interventi/${n.interventoId}/ack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept, note }),
      });
      if (r.ok) {
        // Sparisce il richiamo su tutte le notifiche dello stesso intervento.
        setItems((prev) =>
          prev.map((x) => (x.interventoId === n.interventoId ? { ...x, needsAck: false } : x))
        );
        if (!n.read) void markRead([n.id]);
      }
    } finally {
      setAcking(null);
    }
  }

  function targetHref(n: Notif): string | null {
    // In Campo l'intervento ha una pagina sua: lo stesso href desktop porterebbe
    // a un guscio che l'utente operativo non può nemmeno aprire.
    if (variant === "campo") return n.interventoId ? `/campo/interventi/${n.interventoId}` : null;
    return n.href;
  }

  async function openNotif(n: Notif) {
    if (!n.read) void markRead([n.id]);
    const href = targetHref(n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div className="notif-wrap" ref={box}>
      <button
        className={"icon-btn" + (variant === "campo" ? " campo-bell" : "")}
        onClick={toggle}
        aria-label={unread ? `Notifiche (${unread} non lette)` : "Notifiche"}
        aria-expanded={open}
      >
        <Icon name="bell" size={variant === "campo" ? 20 : 18} />
        {unread > 0 && <span className="notif-badge">{badge}</span>}
      </button>

      {open && (
        <div className={"notif-panel" + (variant === "campo" ? " campo" : "")}>
          <div className="notif-panel-head">
            <div>
              <strong>Notifiche</strong>
              {unread > 0 && <span className="notif-count">{unread} non lette</span>}
            </div>
            {unread > 0 && (
              <button className="notif-linkbtn" onClick={() => markRead()}>
                Segna tutte lette
              </button>
            )}
          </div>

          {/* Attivazione delle notifiche di sistema: è l'unico modo per
              riceverle ad app chiusa, e il permesso si può chiedere solo da un
              gesto dell'utente — quindi serve un bottone, non un automatismo. */}
          {push && push !== "on" && push !== "unsupported" && (
            <div className="notif-push">
              <div className="notif-push-txt">
                <strong>Notifiche ad app chiusa</strong>
                <span>
                  {push === "ios-needs-install"
                    ? "Su iPhone/iPad: Condividi → Aggiungi alla schermata Home, poi torna qui."
                    : push === "denied"
                      ? "Permesso negato: riattivalo dalle impostazioni del browser per questo sito."
                      : push === "unconfigured"
                        ? "Non ancora configurate sul server."
                        : "Ricevi gli avvisi di cantiere anche col telefono in tasca."}
                </span>
              </div>
              {push === "off" && (
                <button className="btn-mini" onClick={togglePush} disabled={pushBusy}>
                  {pushBusy ? "…" : "Attiva"}
                </button>
              )}
            </div>
          )}
          {push === "on" && (
            <div className="notif-push on">
              <div className="notif-push-txt">
                <strong>
                  <Icon name="check" size={12} /> Notifiche attive su questo dispositivo
                </strong>
                {pushMsg && <span>{pushMsg}</span>}
              </div>
              <button className="btn-mini ghost" onClick={togglePush} disabled={pushBusy}>
                Disattiva
              </button>
            </div>
          )}
          {push !== "on" && pushMsg && <div className="notif-push-msg">{pushMsg}</div>}

          <div className="notif-list">
            {loading && items.length === 0 && <div className="notif-empty">Carico…</div>}
            {!loading && items.length === 0 && (
              <div className="notif-empty">Nessuna notifica.</div>
            )}
            {items.map((n) => {
              const color = TONE[n.tone] ?? TONE.info;
              const isOpen = expanded === n.id;
              // La prima riga del corpo è la frase di apertura; il resto è il
              // brief del cantiere, che si apre solo se serve.
              const [intro, ...rest] = n.body.split("\n\n");
              const detail = rest.join("\n\n").trim();
              return (
                <div key={n.id} className={"notif-item" + (n.read ? "" : " unread")}>
                  <button className="notif-main" onClick={() => openNotif(n)}>
                    <span className="notif-ic" style={{ background: color + "1f", color }}>
                      <Icon name={n.icon} size={15} />
                    </span>
                    <span className="notif-txt">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-body">{intro}</span>
                      <span className="notif-meta">{ago(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="notif-unread-dot" />}
                  </button>
                  {n.needsAck && (
                    <div className="notif-ack">
                      <span>Confermi che ci sarai?</span>
                      <button
                        className="btn-mini"
                        disabled={acking === n.id}
                        onClick={() => ack(n, true)}
                      >
                        {acking === n.id ? "…" : "Accetto"}
                      </button>
                      <button
                        className="btn-mini ghost"
                        disabled={acking === n.id}
                        onClick={() => ack(n, false)}
                      >
                        Non posso
                      </button>
                    </div>
                  )}
                  {detail && (
                    <>
                      <button
                        className="notif-linkbtn notif-more"
                        onClick={() => setExpanded(isOpen ? null : n.id)}
                      >
                        {isOpen ? "Nascondi dettagli" : "Dettagli cantiere"}
                        <Icon name={isOpen ? "chev-down" : "chev-right"} size={12} />
                      </button>
                      {isOpen && <pre className="notif-detail">{detail}</pre>}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {variant === "desktop" && (
            <div className="notif-panel-foot">
              <button
                className="notif-linkbtn"
                onClick={() => {
                  setOpen(false);
                  router.push("/notifiche");
                }}
              >
                Vedi tutte le notifiche <Icon name="chev-right" size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
