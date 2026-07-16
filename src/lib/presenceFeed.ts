import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { reconcileOpenSessions } from "./presence";
import type { Role } from "@prisma/client";

/**
 * Connettore (polling) verso la web app delle timbrature ZATO.
 *
 * Il timbratore richiede LOGIN utente/password (nessun token API). Il connettore
 * usa un ACCOUNT DI SERVIZIO dedicato (che deve poter vedere le timbrature di
 * TUTTI gli operatori): fa login, ottiene la sessione (cookie) e legge /stampings.
 *
 * Config in .env:
 *   PRESENCE_FEED_URL        es. https://timbratore.zato.servonet.it/it/stampings
 *   PRESENCE_FEED_LOGIN_URL  endpoint di login (POST)
 *   PRESENCE_FEED_USER       utente account di servizio
 *   PRESENCE_FEED_PASS       password account di servizio
 *   PRESENCE_FEED_USER_FIELD (opz.) nome campo utente nel form (default "username")
 *   PRESENCE_FEED_PASS_FIELD (opz.) nome campo password (default "password")
 *   PRESENCE_FEED_TOKEN      (alternativa al login) bearer token, se mai disponibile
 *
 * NB: mappatura campi (`mapStamping`) e flusso di login (form fields / CSRF / JSON
 * vs cookie) sono "best-effort": vanno CONFERMATI col formato reale di /stampings.
 */

export function isFeedConfigured(): boolean {
  return Boolean(process.env.PRESENCE_FEED_URL);
}

function setCookiesOf(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const sc = res.headers.get("set-cookie");
  return sc ? [sc] : [];
}

/** Unisce cookie (name=value), gli ultimi sovrascrivono i precedenti. */
function mergeCookies(prev: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const pair of prev.split("; ").filter(Boolean)) {
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  for (const c of setCookies) {
    const first = c.split(";")[0];
    const i = first.indexOf("=");
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractCsrf(html: string): string | null {
  const input = html.match(/name=["'](?:_token|csrf_token|authenticity_token)["'][^>]*value=["']([^"']+)["']/i)
    || html.match(/value=["']([^"']+)["'][^>]*name=["'](?:_token|csrf_token|authenticity_token)["']/i);
  if (input) return input[1];
  const meta = html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i);
  return meta ? meta[1] : null;
}

/**
 * Login al timbratore: GET pagina (cookie + CSRF) → POST credenziali → cookie
 * di sessione autenticato. Supporta token CSRF (es. Laravel `_token`) e un
 * eventuale codice 2FA statico (sconsigliato; meglio account senza 2FA).
 */
async function login(): Promise<string | null> {
  const loginUrl = process.env.PRESENCE_FEED_LOGIN_URL;
  const user = process.env.PRESENCE_FEED_USER;
  const pass = process.env.PRESENCE_FEED_PASS;
  if (!loginUrl || !user || !pass) return null;

  const userField = process.env.PRESENCE_FEED_USER_FIELD || "username";
  const passField = process.env.PRESENCE_FEED_PASS_FIELD || "password";
  const tokenField = process.env.PRESENCE_FEED_TOKEN_FIELD || "_token";
  const twofa = process.env.PRESENCE_FEED_2FA;
  const twofaField = process.env.PRESENCE_FEED_2FA_FIELD || "two_factor";

  // 1) GET pagina di login → cookie iniziali + CSRF
  const getRes = await fetch(loginUrl, { headers: { accept: "text/html" } });
  let cookies = mergeCookies("", setCookiesOf(getRes));
  const csrf = extractCsrf(await getRes.text().catch(() => ""));

  // 2) POST credenziali
  const body = new URLSearchParams();
  body.set(userField, user);
  body.set(passField, pass);
  if (csrf) body.set(tokenField, csrf);
  if (twofa) body.set(twofaField, twofa);

  const postRes = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html, application/json",
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: body.toString(),
    redirect: "manual", // i cookie di sessione arrivano spesso sul 302 post-login
  });
  cookies = mergeCookies(cookies, setCookiesOf(postRes));
  return cookies || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*35;/g, "#")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cellText(td: string): string {
  return decodeEntities(td.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** "26/06/2026 13:15:07" (ora italiana) → Date (timezone del server = IT). */
function parseItDate(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, d, mo, y, hh, mi, ss] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

export type StampingRow = {
  externalId: string;
  matricola: string | null;
  utente: string | null;
  commessa: string | null;
  anagrafica: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  open: boolean;
};

/**
 * Parsa la tabella HTML di /stampings. Colonne (0-based):
 *  0 checkbox · 1 # · 2 Matricola · 3 Utente · 4 Commessa · 5 Anagrafica ·
 *  6 Descrizione · 7 Iniziato(locale) · 8 Finito(locale) · 9 Iniziato(IT) ·
 *  10 Finito(IT) · 11 Durata · 12 Tipologia · ...
 * Le righe dati hanno `name="ids[]" value="<id>"`.
 */
export function parseStampingsHtml(html: string): StampingRow[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const out: StampingRow[] = [];
  for (const tr of rows) {
    const idm = tr.match(/name=["']ids\[\]["']\s+value=["'](\d+)["']/i);
    if (!idm) continue; // salta header / riga totali
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    const finishedAt = parseItDate(cells[10] || null);
    out.push({
      externalId: idm[1],
      matricola: cells[2] || null,
      utente: cells[3] || null,
      commessa: cells[4] || null,
      anagrafica: cells[5] || null,
      startedAt: parseItDate(cells[9] || null),
      finishedAt,
      open: !finishedAt && !!(cells[2] || cells[4]),
    });
  }
  return out;
}

/** Diagnostica/scraping: ritorna l'HTML grezzo (post-login) di una pagina del timbratore. */
export async function fetchFeedHtml(
  urlOverride?: string
): Promise<{ status: number; contentType: string; body: string }> {
  const url = urlOverride || process.env.PRESENCE_FEED_URL;
  if (!url) throw new Error("PRESENCE_FEED_URL non configurato");
  const token = process.env.PRESENCE_FEED_TOKEN;
  const cookie = token ? null : await login();
  const res = await fetch(url, {
    headers: {
      accept: "text/html",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    body: await res.text(),
  };
}

/* ───────────── Sync anagrafica operatori (/it/users) ───────────── */

export type OperatorRow = {
  externalId: string;
  matricola: string | null;
  badge: string | null;
  nome: string | null;
  cognome: string | null;
  username: string | null;
  email: string | null;
  telefono: string | null;
  ruolo: string | null;
  reparto: string | null;
};

/** Parsa la tabella /it/users. Righe dati: hanno un link /it/users/<id>. */
export function parseOperatorsHtml(html: string): OperatorRow[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const out: OperatorRow[] = [];
  for (const tr of rows) {
    const idm = tr.match(/href=["']\/[a-z]{2}\/users\/(\d+)(?=["'?])/i);
    if (!idm) continue;
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    // 0 # · 1 matricola · 2 badge · 3 nome · 4 cognome · 5 username · 6 email · 7 tel · 8 ruolo · 9 reparto
    out.push({
      externalId: idm[1],
      matricola: cells[1] || null,
      badge: cells[2] || null,
      nome: cells[3] || null,
      cognome: cells[4] || null,
      username: cells[5] || null,
      email: cells[6] || null,
      telefono: cells[7] || null,
      ruolo: cells[8] || null,
      reparto: cells[9] || null,
    });
  }
  return out;
}

function mapOperatorRole(ruolo: string | null): Role {
  const r = (ruolo ?? "").toLowerCase();
  if (r.includes("supervisore")) return "CAPO_OFFICINA";
  if (r === "administrator") return "ADMIN";
  if (r.includes("administrator")) return "CAPO_OFFICINA";
  return "TECNICO_CAMPO";
}

async function upsertOperator(r: OperatorRow, pwHash: string): Promise<"created" | "updated" | "skipped"> {
  const matricola = r.matricola || null;
  const badge = r.badge || null;
  if (!matricola && !badge) return "skipped"; // es. account amministrativi senza badge
  if (r.email && r.email.toLowerCase().endsWith("@servonet.it")) return "skipped";

  const name = `${r.nome ?? ""} ${r.cognome ?? ""}`.trim() || r.username || `Operatore ${matricola}`;
  const email = (r.email && r.email.includes("@") ? r.email : `${matricola || r.username || "op"}@timbratore.local`).toLowerCase();

  try {
    const existing =
      (await prisma.user.findUnique({ where: { email } })) ??
      (matricola ? await prisma.user.findFirst({ where: { matricola } }) : null) ??
      (badge ? await prisma.user.findFirst({ where: { badgeId: badge } }) : null);

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          matricola: matricola ?? existing.matricola,
          badgeId: badge ?? existing.badgeId,
          phone: r.telefono ?? existing.phone,
          reparto: r.reparto ?? existing.reparto,
          name: existing.name || name,
        },
      });
      return "updated";
    }
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: pwHash,
        role: mapOperatorRole(r.ruolo),
        matricola,
        badgeId: badge,
        phone: r.telefono || null,
        reparto: r.reparto || null,
        active: true,
      },
    });
    return "created";
  } catch {
    return "skipped";
  }
}

/** Sincronizza l'anagrafica operatori dal timbratore (tutte le pagine). */
export async function syncOperators(): Promise<{
  pages: number;
  created: number;
  updated: number;
  skipped: number;
}> {
  const baseUrl = process.env.PRESENCE_USERS_URL || "https://timbratore.zato.servonet.it/it/users";
  const token = process.env.PRESENCE_FEED_TOKEN;
  const cookie = token ? null : await login();
  const headers: Record<string, string> = {
    accept: "text/html",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(cookie ? { cookie } : {}),
  };
  const pwHash = await bcrypt.hash("zato2026", 10);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let pages = 0;
  const seen = new Set<string>();

  for (let page = 1; page <= 30; page++) {
    const u = new URL(baseUrl);
    u.searchParams.set("page", String(page));
    const res = await fetch(u.toString(), { headers });
    if (!res.ok) break;
    const rows = parseOperatorsHtml(await res.text());
    const fresh = rows.filter((r) => !seen.has(r.externalId));
    if (fresh.length === 0) break; // pagina già vista o vuota → fine
    pages = page;
    for (const r of fresh) {
      seen.add(r.externalId);
      const res2 = await upsertOperator(r, pwHash);
      if (res2 === "created") created++;
      else if (res2 === "updated") updated++;
      else skipped++;
    }
  }
  return { pages, created, updated, skipped };
}

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export type CommessaHours = {
  total: number;
  byDay: Record<string, number>; // { "YYYY-MM-DD": ore }
  sessions: { day: string; tech: string | null; start: string | null; end: string | null; hours: number }[];
};

/**
 * Ore timbrate su una COMMESSA (codice cantiere) dal timbratore, filtrando
 * server-side per `search[order_name]` + range date. Somma la durata di TUTTE
 * le sessioni (tutti i tecnici della squadra) raggruppate per giorno.
 * `from`/`to` in formato YYYY-MM-DD; default: ultimi 18 mesi → domani.
 */
export async function fetchCommessaHours(
  commessa: string,
  from?: string,
  to?: string
): Promise<CommessaHours> {
  const base = process.env.PRESENCE_FEED_URL;
  if (!base) throw new Error("PRESENCE_FEED_URL non configurato");
  const now = new Date();
  const toDay = to || isoDay(new Date(now.getTime() + 86400000));
  const fromDay = from || isoDay(new Date(now.getFullYear(), now.getMonth() - 18, now.getDate()));

  const token = process.env.PRESENCE_FEED_TOKEN;
  const cookie = token ? null : await login();
  const headers: Record<string, string> = {
    accept: "text/html",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(cookie ? { cookie } : {}),
  };

  const byDay: Record<string, number> = {};
  const sessions: CommessaHours["sessions"] = [];
  let total = 0;
  const seen = new Set<string>(); // id timbratura → evita doppioni tra le pagine

  // La tabella /stampings è paginata (~25 righe/pagina): scorriamo TUTTE le
  // pagine finché non arrivano più righe nuove (max 200 pagine di sicurezza).
  for (let page = 1; page <= 200; page++) {
    const u = new URL(base);
    u.searchParams.set("search[order_name]", commessa);
    u.searchParams.set("search[date_from]", fromDay);
    u.searchParams.set("search[date_to]", toDay);
    u.searchParams.set("page", String(page));

    const res = await fetch(u.toString(), { headers });
    if (!res.ok) break;
    const html = await res.text();
    const rows = parseStampingsHtml(html).filter((r) => (r.commessa ?? "").trim() === commessa.trim());
    if (rows.length === 0) break;

    let fresh = 0;
    for (const r of rows) {
      if (seen.has(r.externalId)) continue; // pagina ripetuta → stop dopo il ciclo
      seen.add(r.externalId);
      fresh++;
      if (!r.startedAt) continue;
      const endMs = (r.finishedAt ?? now).getTime();
      const hours = Math.max(0, (endMs - r.startedAt.getTime()) / 3600000);
      const day = isoDay(r.startedAt);
      byDay[day] = (byDay[day] ?? 0) + hours;
      total += hours;
      sessions.push({
        day,
        tech: r.utente,
        start: r.startedAt.toISOString(),
        end: r.finishedAt?.toISOString() ?? null,
        hours: Math.round(hours * 100) / 100,
      });
    }
    if (fresh === 0) break; // il server ha ignorato "page" (stesse righe) → fine
  }

  for (const k of Object.keys(byDay)) byDay[k] = Math.round(byDay[k] * 100) / 100;
  return { total: Math.round(total * 100) / 100, byDay, sessions };
}

export async function syncStampings(): Promise<{
  fetched: number;
  open: number;
  closed: number;
}> {
  const { status, contentType, body } = await fetchFeedHtml();
  if (!contentType.includes("html") && !/<table/i.test(body))
    throw new Error(`Risposta inattesa da /stampings (status ${status}, ct ${contentType})`);

  const rows = parseStampingsHtml(body);
  if (rows.length === 0)
    throw new Error("Nessuna riga timbratura riconosciuta nella tabella (login fallito o struttura cambiata?)");

  const openRows = rows.filter((r) => r.open);
  const { open, closed } = await reconcileOpenSessions(
    openRows.map((r) => ({
      externalId: r.externalId,
      matricola: r.matricola,
      commessa: r.commessa,
      anagrafica: r.anagrafica,
      startedAt: r.startedAt,
    }))
  );
  return { fetched: rows.length, open, closed };
}
