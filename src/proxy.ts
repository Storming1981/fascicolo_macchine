import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Limiti dei ruoli ristretti, garantiti in un punto solo.
 *
 * I permessi per ruolo bastano a nascondere i pulsanti e a fermare le API che
 * li controllano, ma le route di scrittura sono un centinaio e alcune guardano
 * solo "e' l'autore" o "e' in squadra": affidare i limiti a ognuna vorrebbe
 * dire che basta dimenticarne una.
 *
 * - VISUALIZZATORE: ogni scrittura /api viene rifiutata, salvo le poche
 *   scritture personali e i messaggi di chat (che le route verificano ancora
 *   col si/no della persona).
 * - COLLAUDATORE_ESTERNO: persona di un'altra ditta. Pagine: solo elenco e
 *   fascicolo macchine, profilo e notifiche (il resto rimanda alle macchine).
 *   Scritture: solo la check list di collaudo, piu' quelle personali.
 *
 * Il ruolo arriva dal cookie di sessione firmato: niente banca dati qui.
 */
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PERSONAL: RegExp[] = [
  /^\/api\/auth\//, // login / logout
  /^\/api\/users\/me$/, // il proprio profilo: password, PIN, foto, firma
  /^\/api\/notifications$/, // segnare lette le proprie notifiche
  /^\/api\/push$/, // iscrizione del proprio dispositivo alle notifiche
  /^\/api\/clientlog$/,
  /^\/api\/google\/(auth|callback)$/, // collegamento della propria casella
];

const VIEWER_WRITES: RegExp[] = [
  ...PERSONAL,
  /^\/api\/chat\/[^/]+\/messages(\/[^/]+)?$/, // scrivere (e ritirare i propri) messaggi
];

const EXTERNAL_WRITES: RegExp[] = [...PERSONAL, /^\/api\/machines\/[^/]+\/collaudo$/];

/** Pagine aperte al collaudatore esterno (gli asset con estensione passano). */
const EXTERNAL_PAGES: RegExp[] = [
  /^\/macchine(\/[^/]+)?$/,
  /^\/profilo$/,
  /^\/notifiche$/,
  /^\/login/,
  /^\/uploads\//,
  /\.[a-z0-9]+$/i,
];

const denied = (msg: string) => NextResponse.json({ error: msg }, { status: 403 });

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  // Per le API basta guardare le scritture; le pagine contano solo per l'esterno.
  if (isApi && READ_METHODS.has(req.method)) return NextResponse.next();
  const token = req.cookies.get("ft_session")?.value;
  if (!token) return NextResponse.next();
  let role: unknown;
  try {
    role = (await jwtVerify(token, SECRET)).payload.role;
  } catch {
    return NextResponse.next(); // sessione non valida: ci pensa la route (401)
  }

  if (role === "VISUALIZZATORE") {
    if (!isApi || VIEWER_WRITES.some((re) => re.test(path))) return NextResponse.next();
    return denied("Profilo visualizzatore: accesso in sola lettura.");
  }

  if (role === "COLLAUDATORE_ESTERNO") {
    if (isApi) {
      if (EXTERNAL_WRITES.some((re) => re.test(path))) return NextResponse.next();
      return denied("Profilo collaudatore esterno: si può compilare solo la check list di collaudo.");
    }
    if (path === "/macchine/nuova" || !EXTERNAL_PAGES.some((re) => re.test(path))) {
      // Dietro al proxy req.url e' l'indirizzo del container (0.0.0.0:3000):
      // il dominio vero sta negli header inoltrati (vedi lib/absoluteUrl.ts).
      const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
      return NextResponse.redirect(`${proto}://${host}/macchine`);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Tutto tranne gli asset di Next: le pagine servono per il collaudatore esterno.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
