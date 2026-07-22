import "server-only";
import { prisma } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import {
  getGoogleAccount,
  saveGoogleAccount,
  clearGoogleAccount,
  type GoogleAccount,
} from "./settings";

/**
 * Integrazione Google (OAuth 2.0 + Gmail API) per inviare i rapportini.
 *
 * Due livelli:
 *  - PERSONALE: ogni utente collega la propria casella Gmail (model GoogleToken,
 *    uno per userId) → invia dal proprio indirizzo.
 *  - AZIENDALE (fallback): un unico account nel Setting `googleAccount`, usato da
 *    chi non ha collegato la propria casella.
 *
 * I token stanno cifrati (src/lib/crypto.ts) e non escono mai verso il client.
 *
 * Config in .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
 * GOOGLE_TOKEN_ENC_KEY (opz., default AUTH_SECRET).
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/** Bersaglio del collegamento: casella personale dell'utente o aziendale. */
export type GoogleTarget = "me" | "company";

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
  );
}

/* ─────────────── Rappresentazione interna di un token ─────────────── */

type StoredToken = {
  email: string;
  refreshEnc: string; // refresh token cifrato
  accessEnc: string | null; // access token cifrato
  expiresAtMs: number | null;
  scope: string | null;
};

/** Legge il token personale di un utente. */
async function readUserToken(userId: string): Promise<StoredToken | null> {
  const t = await prisma.googleToken.findUnique({ where: { userId } });
  if (!t) return null;
  return {
    email: t.email,
    refreshEnc: t.refreshToken,
    accessEnc: t.accessToken,
    expiresAtMs: t.expiresAt ? t.expiresAt.getTime() : null,
    scope: t.scope,
  };
}

/** Legge il token aziendale (Setting). */
async function readCompanyToken(): Promise<StoredToken | null> {
  const acc = await getGoogleAccount();
  if (!acc) return null;
  return {
    email: acc.email,
    refreshEnc: acc.refreshToken,
    accessEnc: acc.accessToken,
    expiresAtMs: acc.expiresAt,
    scope: acc.scope,
  };
}

/** Aggiorna l'access token (dopo un refresh) del token personale. */
async function writeUserAccess(userId: string, accessEnc: string, expiresAtMs: number) {
  await prisma.googleToken.update({
    where: { userId },
    data: { accessToken: accessEnc, expiresAt: new Date(expiresAtMs) },
  });
}

/** Aggiorna l'access token del token aziendale. */
async function writeCompanyAccess(accessEnc: string, expiresAtMs: number) {
  const acc = await getGoogleAccount();
  if (!acc) return;
  await saveGoogleAccount({ ...acc, accessToken: accessEnc, expiresAt: expiresAtMs });
}

/* ─────────────────────────── OAuth flow ─────────────────────────── */

/** URL della schermata di consenso Google (offline + prompt=consent → refresh token). */
export function buildConsentUrl(state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postForm(url: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

/**
 * Scambia il `code` del callback con i token e li salva sul bersaglio scelto
 * (personale dell'utente o aziendale). Ritorna l'indirizzo email collegato.
 */
export async function exchangeCodeAndSave(
  code: string,
  target: GoogleTarget,
  userId: string,
  connectedByName: string | null
): Promise<string> {
  const tok = await postForm(TOKEN_URL, {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    grant_type: "authorization_code",
  });
  if (!tok.access_token || tok.error)
    throw new Error(tok.error_description || tok.error || "Scambio token fallito");
  if (!tok.refresh_token)
    throw new Error("Google non ha restituito un refresh token: revoca l'accesso dell'app e riprova.");

  const who = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${tok.access_token}` } });
  const info = (await who.json().catch(() => ({}))) as { email?: string };
  const email = info.email;
  if (!email) throw new Error("Impossibile leggere l'indirizzo dell'account Google.");

  const expiresAtMs = Date.now() + (tok.expires_in ?? 3600) * 1000;

  if (target === "company") {
    await saveGoogleAccount({
      email,
      refreshToken: encryptSecret(tok.refresh_token),
      accessToken: encryptSecret(tok.access_token),
      expiresAt: expiresAtMs,
      scope: tok.scope ?? GOOGLE_SCOPES,
      connectedByName,
      connectedAt: new Date().toISOString(),
    } satisfies GoogleAccount);
  } else {
    await prisma.googleToken.upsert({
      where: { userId },
      update: {
        email,
        refreshToken: encryptSecret(tok.refresh_token),
        accessToken: encryptSecret(tok.access_token),
        expiresAt: new Date(expiresAtMs),
        scope: tok.scope ?? GOOGLE_SCOPES,
        connectedAt: new Date(),
      },
      create: {
        userId,
        email,
        refreshToken: encryptSecret(tok.refresh_token),
        accessToken: encryptSecret(tok.access_token),
        expiresAt: new Date(expiresAtMs),
        scope: tok.scope ?? GOOGLE_SCOPES,
      },
    });
  }
  return email;
}

/** Access token valido per uno StoredToken (refresh automatico + persistenza). */
async function ensureAccessToken(
  stored: StoredToken,
  saveBack: (accessEnc: string, expiresAtMs: number) => Promise<void>
): Promise<string> {
  const current = decryptSecret(stored.accessEnc);
  if (current && stored.expiresAtMs && stored.expiresAtMs - 60_000 > Date.now()) return current;

  const refresh = decryptSecret(stored.refreshEnc);
  if (!refresh) throw new Error("Token Google illeggibile: ricollega la casella.");

  const tok = await postForm(TOKEN_URL, {
    refresh_token: refresh,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  if (!tok.access_token)
    throw new Error(tok.error_description || tok.error || "Rinnovo token Google fallito: ricollega la casella.");

  const expiresAtMs = Date.now() + (tok.expires_in ?? 3600) * 1000;
  await saveBack(encryptSecret(tok.access_token), expiresAtMs);
  return tok.access_token;
}

/** Revoca un refresh token lato Google (best-effort). */
async function revoke(refreshEnc: string) {
  const refresh = decryptSecret(refreshEnc);
  if (!refresh) return;
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refresh }).toString(),
  }).catch(() => null);
}

/** Scollega la casella personale di un utente. */
export async function disconnectUser(userId: string): Promise<void> {
  const t = await prisma.googleToken.findUnique({ where: { userId } });
  if (t) await revoke(t.refreshToken);
  await prisma.googleToken.deleteMany({ where: { userId } });
}

/** Scollega la casella aziendale. */
export async function disconnectCompany(): Promise<void> {
  const acc = await getGoogleAccount();
  if (acc) await revoke(acc.refreshToken);
  await clearGoogleAccount();
}

/* ─────────────────────── Info per la UI (no token) ─────────────────────── */

export async function getUserGoogleInfo(
  userId: string
): Promise<{ email: string; connectedAt: string } | null> {
  const t = await prisma.googleToken.findUnique({ where: { userId } });
  return t ? { email: t.email, connectedAt: t.connectedAt.toISOString() } : null;
}

export async function getCompanyGoogleInfo(): Promise<
  { email: string; connectedAt: string; connectedByName: string | null } | null
> {
  const acc = await getGoogleAccount();
  return acc
    ? { email: acc.email, connectedAt: acc.connectedAt, connectedByName: acc.connectedByName }
    : null;
}

/**
 * Indirizzo mittente per un utente: la sua casella personale se collegata,
 * altrimenti quella aziendale; null se nessuna delle due è disponibile.
 */
export async function resolveSenderEmail(userId: string): Promise<string | null> {
  const personal = await prisma.googleToken.findUnique({ where: { userId }, select: { email: true } });
  if (personal) return personal.email;
  const acc = await getGoogleAccount();
  return acc?.email ?? null;
}

/* ─────────────────────────── Invio Gmail ─────────────────────────── */

/** Header non-ASCII → encoded-word RFC 2047. */
function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** base64 spezzato a 76 colonne (richiesto dal MIME). */
function b64Lines(buf: Buffer): string {
  return (buf.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

export type MailAttachment = { filename: string; mimeType: string; content: Buffer };

export type SendMailInput = {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
};

/**
 * Invia una mail per conto di `userId`: usa la casella personale se collegata,
 * altrimenti quella aziendale. Lancia se nessuna delle due è disponibile.
 * Ritorna l'indirizzo mittente effettivo e l'id del messaggio.
 */
export async function sendGmailAs(userId: string, input: SendMailInput): Promise<{ id: string; from: string }> {
  const personal = await readUserToken(userId);
  const stored = personal ?? (await readCompanyToken());
  if (!stored)
    throw new Error("Nessuna casella Gmail collegata: collega la tua in Impostazioni o chiedi all'amministratore.");

  const saveBack = personal
    ? (a: string, e: number) => writeUserAccess(userId, a, e)
    : (a: string, e: number) => writeCompanyAccess(a, e);

  const token = await ensureAccessToken(stored, saveBack);
  const from = stored.email;
  const boundary = `zato_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  const head = [
    `From: ${from}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
  ].join("\r\n");

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(Buffer.from(input.text, "utf8")),
  ].join("\r\n");

  const parts = (input.attachments ?? []).map((a) =>
    [
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      b64Lines(a.content),
    ].join("\r\n")
  );

  const mime = [head, body, ...parts, `--${boundary}--`, ""].join("\r\n");
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const out = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !out.id) throw new Error(out.error?.message || `Invio Gmail fallito (HTTP ${res.status})`);
  return { id: out.id, from };
}
