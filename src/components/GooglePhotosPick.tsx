"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

/**
 * Pesca una o più foto dal **Google Foto dell'utente** e le porta nel
 * fascicolo.
 *
 * In officina si scatta col telefono e la foto è già nel proprio Google Foto:
 * rifarla dal computer non si può, e passarsela via chat per ricaricarla è il
 * giro lungo. Da qui si apre Google Foto, si sceglie, e lo scatto entra nel
 * fascicolo come un caricamento qualunque.
 *
 * Il giro è imposto da Google: l'app **non può leggere** la libreria, quindi si
 * apre una finestra sua dove l'utente sceglie, e si aspetta che abbia finito.
 * Da qui le due cose che si vedono: la finestra nuova (l'iframe è vietato) e
 * l'attesa con il pulsante *Ho finito* per chi chiude la finestra a modo suo.
 *
 * Con `source="archive"` si pesca invece dall'**archivio foto aziendale**: un
 * account Google collegato una volta sola in Impostazioni, uguale per tutti gli
 * operatori. Il token sta sul server, quindi non c'è niente da collegare — ma
 * Google pretende che la finestra sia aperta *dallo stesso account che possiede
 * la sessione*, perciò lì dentro va fatto l'accesso con l'indirizzo
 * dell'archivio, che infatti viene mostrato durante l'attesa.
 */
export default function GooglePhotosPick({
  machineId,
  machineCode,
  source = "me",
  category,
  componentItemId,
  label = "Da Google Foto",
  icon = "image",
  className = "btn-ghost-sm",
  title,
  onDone,
  onImported,
  onBusyChange,
  notify,
}: {
  machineId: string;
  /** Serve solo per tornare sul fascicolo giusto dopo il consenso Google. */
  machineCode: string;
  /** `me` = il proprio Google Foto · `archive` = l'archivio foto aziendale. */
  source?: "me" | "archive";
  /** Cartella in cui finisce la foto (produzione, collaudo…). */
  category?: string;
  /** Slot componente a cui agganciarla: la foto nasce già sulla matricola. */
  componentItemId?: string | null;
  label?: string;
  icon?: string;
  className?: string;
  title?: string;
  onDone: () => void;
  /** Path delle foto appena importate: chi le aggancia a uno slot ci legge la matricola. */
  onImported?: (paths: string[]) => void | Promise<void>;
  /**
   * Scelta in corso (finestra di Google aperta, attesa, importazione). Serve a
   * chi mette questo pulsante dentro un menu: chiudendolo a meta' il
   * componente si smonta e l'importazione si interrompe.
   */
  onBusyChange?: (busy: boolean) => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [phase, setPhase] = useState<"idle" | "open" | "waiting" | "importing">("idle");
  const [needsAuth, setNeedsAuth] = useState(false);
  /** Account che possiede la sessione: con questo va fatto l'accesso. */
  const [account, setAccount] = useState("");
  const archive = source === "archive";
  const session = useRef<{ id: string; uri: string } | null>(null);
  const win = useRef<Window | null>(null);
  const stop = useRef(false);

  // La pagina può cambiare mentre si aspetta: il giro di controlli va fermato,
  // altrimenti continua a chiamare il server per una scelta che non interessa
  // più a nessuno.
  useEffect(
    () => () => {
      stop.current = true;
    },
    []
  );

  // Chi ci sta intorno (un menu) deve sapere che c'e' una scelta in corso.
  useEffect(() => {
    onBusyChange?.(phase !== "idle");
    // onBusyChange e' una callback del genitore: inseguirla qui farebbe
    // ripartire l'effetto a ogni render senza aggiungere niente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function start() {
    setNeedsAuth(false);
    setPhase("open");
    const res = await fetch("/api/google/picker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPhase("idle");
      setNeedsAuth(!!d.needsAuth);
      return notify(d.error || "Google Foto non disponibile", "err");
    }
    session.current = { id: d.sessionId, uri: d.pickerUri };
    setAccount(typeof d.account === "string" ? d.account : "");
    // La finestra si apre **dentro** il gesto dell'utente: aprirla dopo una
    // risposta asincrona la farebbe bloccare come popup su quasi tutti i
    // browser. Per questo il link resta anche a video, se è successo lo stesso.
    win.current = window.open(d.pickerUri, "_blank", "noopener,width=900,height=760");
    setPhase("waiting");
    poll(d.sessionId, d.pollMs ?? 3000, Date.now() + (d.timeoutMs ?? 600000));
  }

  async function poll(sessionId: string, pollMs: number, until: number) {
    stop.current = false;
    while (!stop.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (stop.current) return;
      const res = await fetch(
        `/api/google/picker?sessionId=${encodeURIComponent(sessionId)}&source=${source}`
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("idle");
        return notify(d.error || "Sessione scaduta: riprova", "err");
      }
      if (d.pollMs) pollMs = d.pollMs;
      if (d.ready) return finish(sessionId);
    }
    if (!stop.current) {
      setPhase("idle");
      notify("Tempo scaduto: riapri Google Foto e riprova", "err");
    }
  }

  async function finish(sessionId: string) {
    stop.current = true;
    setPhase("importing");
    try {
      win.current?.close();
    } catch {
      /* la finestra può essere già chiusa, o di un altro dominio */
    }
    const res = await fetch(`/api/machines/${machineId}/photos/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, category, componentItemId, source }),
    });
    const d = await res.json().catch(() => ({}));
    setPhase("idle");
    session.current = null;
    if (!res.ok) return notify(d.error || "Importazione non riuscita", "err");
    onDone();
    if (onImported && Array.isArray(d.paths) && d.paths.length) await onImported(d.paths);
    notify(
      `${d.count} ${d.count === 1 ? "foto importata" : "foto importate"} ` +
        (archive ? "dall'archivio aziendale" : "da Google Foto") +
        (d.skipped?.length ? ` · ${d.skipped.length} saltate` : "")
    );
  }

  if (needsAuth)
    return (
      <a
        className={className}
        href={`/api/google/auth?target=me&picker=1&return=m:${encodeURIComponent(machineCode)}`}
        title="Serve il tuo permesso: scegli tu quali foto vede la piattaforma"
      >
        <Icon name="upload" size={14} />
        {label ? " Autorizza Google Foto" : ""}
      </a>
    );

  if (phase === "waiting")
    return (
      <span className="gphoto-wait">
        <span className="muted small">
          {archive && account
            ? // Google vuole che la finestra sia aperta dall'account che possiede
              // la sessione: senza dirlo, chi è loggato col proprio Google vede
              // "account sbagliato" e pensa che la piattaforma sia rotta.
              `Accedi con ${account} nella finestra di Google e scegli le foto…`
            : "Scegli le foto nella finestra di Google…"}
        </span>
        <button className="btn-primary-sm" onClick={() => session.current && finish(session.current.id)}>
          Ho finito
        </button>
        {session.current && (
          <a className="btn-ghost-sm" href={session.current.uri} target="_blank" rel="noreferrer">
            Riapri
          </a>
        )}
      </span>
    );

  return (
    <button
      className={className}
      disabled={phase !== "idle"}
      onClick={start}
      title={
        title ??
        (archive
          ? "Scegli una foto dall'archivio foto aziendale (serve l'accesso a quell'account nella finestra di Google)"
          : "Scegli una foto dal tuo account Google Foto")
      }
    >
      <Icon name={icon} size={14} />
      {label && (
        <>
          {" "}
          {phase === "open"
            ? archive
              ? "Apro l'archivio…"
              : "Apro Google Foto…"
            : phase === "importing"
              ? "Importo…"
              : label}
        </>
      )}
    </button>
  );
}
