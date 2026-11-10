"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/**
 * Form di login con POST NATIVO (senza fetch): il browser invia le credenziali
 * e segue il redirect del server applicando il cookie di sessione in modo
 * nativo. È la modalità più affidabile su iOS Safari. Il JS serve solo per
 * l'occhio sulla password e per la richiesta di ripristino all'admin.
 */
export default function LoginForm({ error, portale }: { error?: boolean; portale?: boolean }) {
  const [show, setShow] = useState(false);
  const [id, setId] = useState("");
  const [forgot, setForgot] = useState(false);

  return (
    <>
      <form className="login-form" method="POST" action="/api/auth/login">
        {error && <div className="form-error">Credenziali non valide</div>}
        {portale && <input type="hidden" name="portale" value="1" />}
        <div className="form-row">
          <label>{portale ? "Email" : "Email o nome utente"}</label>
          <input
            className="input"
            type={portale ? "email" : "text"}
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={portale ? "email fornita da ZATO" : "nome@zato.it"}
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>Password</label>
          <div className="pw-field">
            <input
              className="input"
              type={show ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Nascondi password" : "Mostra password"}
              title={show ? "Nascondi password" : "Mostra password"}
              aria-pressed={show}
            >
              <EyeIcon off={show} />
            </button>
          </div>
        </div>
        <button className="btn-primary" style={{ justifyContent: "center", padding: "10px" }}>
          <Icon name="logout" size={15} /> Accedi
        </button>
        <button type="button" className="login-forgot" onClick={() => setForgot((f) => !f)}>
          Password dimenticata?
        </button>
      </form>
      {forgot && <ResetRequest initialId={id} onClose={() => setForgot(false)} />}
    </>
  );
}

function ResetRequest({ initialId, onClose }: { initialId: string; onClose: () => void }) {
  const [id, setId] = useState(initialId);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setState("sending");
    try {
      const r = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Invio non riuscito");
      }
      setState("sent");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invio non riuscito");
      setState("idle");
    }
  }

  if (state === "sent")
    return (
      <div className="login-reset">
        <div className="login-reset-ok">
          <Icon name="check" size={15} /> Richiesta inviata. Un amministratore ti imposterà una nuova password e
          te la comunicherà.
        </div>
        <button type="button" className="login-forgot" onClick={onClose}>
          Torna al login
        </button>
      </div>
    );

  return (
    <form className="login-reset" onSubmit={send}>
      <p className="small muted" style={{ margin: 0 }}>
        La password la reimposta un amministratore: scrivi con cosa accedi e gli arriva la richiesta.
      </p>
      {err && <div className="form-error">{err}</div>}
      <div className="form-row">
        <label>Email o nome utente</label>
        <input
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </div>
      <div className="form-row">
        <label>Messaggio (facoltativo)</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="es. come contattarti"
          maxLength={500}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn-ghost" onClick={onClose} disabled={state === "sending"}>
          Annulla
        </button>
        <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={state === "sending"}>
          {state === "sending" ? "Invio…" : "Chiedi il ripristino"}
        </button>
      </div>
    </form>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
