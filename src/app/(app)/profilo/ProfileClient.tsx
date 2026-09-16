"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { initials } from "@/lib/domain";
import { fmtDateTime } from "@/lib/format";

type Msg = { kind: "ok" | "err"; text: string } | null;

type Props = {
  user: {
    name: string;
    email: string;
    roleLabel: string;
    phone: string | null;
    photo: string | null;
    reparto: string | null;
    matricola: string | null;
    hasPin: boolean;
    signatureImage: string | null;
  };
  googleConfigured: boolean;
  google: { email: string; connectedAt: string } | null;
  companyEmail: string | null;
};

async function patchMe(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const d = await res.json().catch(() => ({}));
  return d.error || "Salvataggio non riuscito";
}

/** Riduce la foto a un quadrato di 256 px (dataURL JPEG): basta per l'avatar. */
function photoToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 256;
      const side = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Immagine non leggibile"));
    img.src = url;
  });
}

export default function ProfileClient({ user, googleConfigured, google, companyEmail }: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();

  // Esito del ritorno dal consenso Google (/profilo?google=ok|err)
  const [googleMsg, setGoogleMsg] = useState<Msg>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const g = sp.get("google");
    if (!g) return;
    setGoogleMsg(
      g === "ok"
        ? { kind: "ok", text: `Casella collegata: ${sp.get("email") ?? ""}` }
        : { kind: "err", text: sp.get("msg") || "Collegamento Google non riuscito" }
    );
    window.history.replaceState(null, "", "/profilo");
  }, []);

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Il mio profilo</h1>
          <p>Dati personali, casella di posta per gli invii, password, PIN e firma</p>
        </div>
      </div>

      <div className="pf-grid">
        <div className="pf-col">
          <IdentityCard user={user} onSaved={refresh} />
          <GmailCard
            configured={googleConfigured}
            google={google}
            companyEmail={companyEmail}
            userEmail={user.email}
            initialMsg={googleMsg}
            onChanged={refresh}
          />
        </div>
        <div className="pf-col">
          <PasswordCard />
          <PinCard hasPin={user.hasPin} onSaved={refresh} />
          <SignatureCard image={user.signatureImage} onSaved={refresh} />
        </div>
      </div>
    </div>
  );
}

function CardHead({ icon, title, sub, badge }: { icon: string; title: string; sub: string; badge?: React.ReactNode }) {
  return (
    <div className="pf-card-head">
      <span className="pf-card-icon">
        <Icon name={icon} size={18} />
      </span>
      <div className="pf-card-titles">
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      {badge}
    </div>
  );
}

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <div className={msg.kind === "ok" ? "form-ok" : "form-error"}>{msg.text}</div>;
}

/* ── Dati personali + foto ─────────────────────────────── */
function IdentityCard({ user, onSaved }: { user: Props["user"]; onSaved: () => void }) {
  const [phone, setPhone] = useState(user.phone ?? "");
  const [photo, setPhoto] = useState(user.photo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function savePhone() {
    setBusy(true);
    const err = await patchMe({ phone });
    setBusy(false);
    setMsg(err ? { kind: "err", text: err } : { kind: "ok", text: "Telefono salvato" });
    if (!err) onSaved();
  }

  async function changePhoto(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const dataUrl = await photoToDataUrl(f);
      const err = await patchMe({ photo: dataUrl });
      if (err) setMsg({ kind: "err", text: err });
      else {
        setPhoto(dataUrl);
        setMsg({ kind: "ok", text: "Foto aggiornata" });
        onSaved();
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Foto non valida" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setBusy(true);
    const err = await patchMe({ photo: null });
    setBusy(false);
    if (err) setMsg({ kind: "err", text: err });
    else {
      setPhoto(null);
      onSaved();
    }
  }

  return (
    <section className="card pf-card pf-identity">
      <div className="pf-hero">
        <button className="pf-avatar" onClick={() => fileRef.current?.click()} disabled={busy} title="Cambia foto">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={user.name} />
          ) : (
            <span>{initials(user.name)}</span>
          )}
          <span className="pf-avatar-edit">
            <Icon name="camera" size={14} />
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => changePhoto(e.target.files)} />
        <div className="pf-hero-text">
          <h2>{user.name}</h2>
          <div className="pf-hero-meta">
            <span className="pf-role">{user.roleLabel}</span>
            <span className="muted">{user.email}</span>
          </div>
          {photo && (
            <button className="pf-link" onClick={removePhoto} disabled={busy}>
              Togli la foto
            </button>
          )}
        </div>
      </div>

      <dl className="pf-kv">
        <div>
          <dt>Nome</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>E-mail di accesso</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Ruolo</dt>
          <dd>{user.roleLabel}</dd>
        </div>
        {user.reparto && (
          <div>
            <dt>Reparto</dt>
            <dd>{user.reparto}</dd>
          </div>
        )}
        {user.matricola && (
          <div>
            <dt>Matricola</dt>
            <dd className="mono">{user.matricola}</dd>
          </div>
        )}
      </dl>
      <p className="muted small pf-note">Nome, e-mail e ruolo li modifica l&apos;amministratore da Persone &amp; Firme.</p>

      <div className="pf-inline">
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">Telefono</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 …" inputMode="tel" />
        </label>
        <button
          className="btn-primary-sm"
          onClick={savePhone}
          disabled={busy || phone.trim() === (user.phone ?? "")}
        >
          Salva
        </button>
      </div>
      <Feedback msg={msg} />
    </section>
  );
}

/* ── Casella Gmail ──────────────────────────────────────── */
function GmailCard({
  configured,
  google,
  companyEmail,
  userEmail,
  initialMsg,
  onChanged,
}: {
  configured: boolean;
  google: Props["google"];
  companyEmail: string | null;
  userEmail: string;
  initialMsg: Msg;
  onChanged: () => void;
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<null | "test" | "unlink">(null);
  useEffect(() => {
    if (initialMsg) setMsg(initialMsg);
  }, [initialMsg]);

  const connectHref = "/api/google/auth?target=me&return=profilo";

  async function test() {
    setBusy("test");
    const res = await fetch("/api/google/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: google?.email ?? userEmail }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(res.ok ? { kind: "ok", text: `Mail di prova inviata a ${d.to} da ${d.from}` } : { kind: "err", text: d.error || "Invio non riuscito" });
  }

  async function unlink() {
    if (!confirm("Scollegare la tua casella Gmail? Gli invii useranno la casella aziendale, se disponibile.")) return;
    setBusy("unlink");
    const res = await fetch("/api/google/account?target=me", { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      setMsg({ kind: "ok", text: "Casella scollegata" });
      onChanged();
    } else setMsg({ kind: "err", text: "Scollegamento non riuscito" });
  }

  return (
    <section className="card pf-card">
      <CardHead
        icon="upload"
        title="Casella di posta"
        sub="Le schede e i rapportini partono dal tuo indirizzo Gmail"
        badge={
          google ? (
            <span className="pf-badge ok">
              <Icon name="check" size={12} /> Collegata
            </span>
          ) : (
            <span className="pf-badge">Non collegata</span>
          )
        }
      />

      {!configured ? (
        <div className="info-banner warn">
          <Icon name="upload" size={16} />
          <span>Integrazione Google non ancora configurata sul server: contatta l&apos;amministratore.</span>
        </div>
      ) : google ? (
        <>
          <div className="pf-mailbox">
            <span className="pf-mailbox-icon">G</span>
            <div>
              <strong>{google.email}</strong>
              <div className="muted small">collegata il {fmtDateTime(google.connectedAt)}</div>
            </div>
          </div>
          <div className="pf-actions">
            <button className="btn-ghost-sm" onClick={test} disabled={busy !== null}>
              {busy === "test" ? "Invio…" : "Invia mail di prova"}
            </button>
            <a className="btn-ghost-sm" href={connectHref}>
              Cambia casella
            </a>
            <button className="btn-ghost-sm danger" onClick={unlink} disabled={busy !== null}>
              Scollega
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pf-text">
            Accedi con il tuo account Google: autorizzi solo l&apos;<strong>invio</strong> di e-mail, la piattaforma
            non legge la tua posta.
          </p>
          <a className="pf-google-btn" href={connectHref}>
            <span className="pf-google-g">G</span> Accedi con Google
          </a>
          {companyEmail && (
            <p className="muted small pf-note">
              Finché non la colleghi, gli invii partono dalla casella aziendale <strong>{companyEmail}</strong>.
            </p>
          )}
        </>
      )}
      <Feedback msg={msg} />
    </section>
  );
}

/* ── Password ───────────────────────────────────────────── */
function PasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function save() {
    if (next.length < 8) return setMsg({ kind: "err", text: "La nuova password deve avere almeno 8 caratteri" });
    if (next !== again) return setMsg({ kind: "err", text: "Le due password non coincidono" });
    setBusy(true);
    const err = await patchMe({ currentPassword: cur, newPassword: next });
    setBusy(false);
    if (err) setMsg({ kind: "err", text: err });
    else {
      setMsg({ kind: "ok", text: "Password cambiata" });
      setCur("");
      setNext("");
      setAgain("");
    }
  }

  return (
    <section className="card pf-card">
      <CardHead icon="sign" title="Password" sub="Per entrare nella piattaforma" />
      <div className="pf-form">
        <label className="field">
          <span className="field-label">Password attuale</span>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </label>
        <div className="pf-two">
          <label className="field">
            <span className="field-label">Nuova password</span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            <span className="field-label">Ripeti</span>
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <div className="pf-actions">
          <button className="btn-primary-sm" onClick={save} disabled={busy || !cur || !next}>
            {busy ? "Salvataggio…" : "Cambia password"}
          </button>
        </div>
        <Feedback msg={msg} />
      </div>
    </section>
  );
}

/* ── PIN di firma ───────────────────────────────────────── */
function PinCard({ hasPin, onSaved }: { hasPin: boolean; onSaved: () => void }) {
  const [cur, setCur] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function save() {
    if (!/^\d{4,6}$/.test(pin)) return setMsg({ kind: "err", text: "Il PIN deve avere da 4 a 6 cifre" });
    setBusy(true);
    const err = await patchMe({ currentPassword: cur, pin });
    setBusy(false);
    if (err) setMsg({ kind: "err", text: err });
    else {
      setMsg({ kind: "ok", text: hasPin ? "PIN cambiato" : "PIN impostato" });
      setCur("");
      setPin("");
      onSaved();
    }
  }

  return (
    <section className="card pf-card">
      <CardHead
        icon="check"
        title="PIN di firma"
        sub="Per firmare interventi e collaudi senza disegnare"
        badge={hasPin ? <span className="pf-badge ok"><Icon name="check" size={12} /> Impostato</span> : <span className="pf-badge">Non impostato</span>}
      />
      <div className="pf-form">
        <div className="pf-two">
          <label className="field">
            <span className="field-label">Password attuale</span>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="field">
            <span className="field-label">{hasPin ? "Nuovo PIN" : "PIN"}</span>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </label>
        </div>
        <div className="pf-actions">
          <button className="btn-primary-sm" onClick={save} disabled={busy || !cur || !pin}>
            {busy ? "Salvataggio…" : hasPin ? "Cambia PIN" : "Imposta PIN"}
          </button>
        </div>
        <Feedback msg={msg} />
      </div>
    </section>
  );
}

/* ── Firma personale ────────────────────────────────────── */
function SignatureCard({ image, onSaved }: { image: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(!image);
  const [current, setCurrent] = useState(image);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  async function save() {
    if (sigRef.current?.isEmpty()) return setMsg({ kind: "err", text: "Disegna la firma prima di salvarla" });
    const dataUrl = sigRef.current?.toDataURL();
    if (!dataUrl) return;
    setBusy(true);
    const err = await patchMe({ signatureImage: dataUrl });
    setBusy(false);
    if (err) setMsg({ kind: "err", text: err });
    else {
      setCurrent(dataUrl);
      setEditing(false);
      setMsg({ kind: "ok", text: "Firma salvata" });
      onSaved();
    }
  }

  async function remove() {
    if (!confirm("Eliminare la firma personale salvata?")) return;
    setBusy(true);
    const err = await patchMe({ signatureImage: null });
    setBusy(false);
    if (err) setMsg({ kind: "err", text: err });
    else {
      setCurrent(null);
      setEditing(true);
      onSaved();
    }
  }

  return (
    <section className="card pf-card">
      <CardHead icon="sign" title="Firma personale" sub="Si applica con un tocco su schede, collaudi e rapportini" />
      {editing ? (
        <>
          <SignaturePad ref={sigRef} height={150} />
          <div className="pf-actions">
            <button className="btn-ghost-sm" onClick={() => sigRef.current?.clear()} disabled={busy}>
              Cancella
            </button>
            {current && (
              <button className="btn-ghost-sm" onClick={() => setEditing(false)} disabled={busy}>
                Annulla
              </button>
            )}
            <button className="btn-primary-sm" onClick={save} disabled={busy}>
              {busy ? "Salvataggio…" : "Salva firma"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="pf-signature">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {current && <img src={current} alt="Firma personale" />}
          </div>
          <div className="pf-actions">
            <button className="btn-ghost-sm" onClick={() => setEditing(true)} disabled={busy}>
              Ridisegna
            </button>
            <button className="btn-ghost-sm danger" onClick={remove} disabled={busy}>
              Elimina
            </button>
          </div>
        </>
      )}
      <Feedback msg={msg} />
    </section>
  );
}
