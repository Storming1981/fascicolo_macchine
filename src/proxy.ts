import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Sola lettura per il ruolo VISUALIZZATORE, garantita in un punto solo.
 *
 * I permessi per ruolo bastano a nascondere i pulsanti e a fermare le API che
 * li controllano, ma le route di scrittura sono un centinaio e alcune guardano
 * solo "e' l'autore" o "e' in squadra": affidare la sola lettura a ognuna
 * vorrebbe dire che basta dimenticarne una. Qui ogni richiesta che non sia una
 * lettura viene rifiutata, salvo le poche scritture personali qui sotto e i
 * messaggi di chat (che le route verificano ancora col si/no della persona).
 *
 * Il ruolo arriva dal cookie di sessione firmato: niente banca dati qui.
 */
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const ALLOWED: RegExp[] = [
  /^\/api\/auth\//, // login / logout
  /^\/api\/users\/me$/, // il proprio profilo: password, PIN, foto
  /^\/api\/notifications$/, // segnare lette le proprie notifiche
  /^\/api\/push$/, // iscrizione del proprio dispositivo alle notifiche
  /^\/api\/clientlog$/,
  /^\/api\/google\/(auth|callback)$/, // collegamento della propria casella
  /^\/api\/chat\/[^/]+\/messages(\/[^/]+)?$/, // scrivere (e ritirare i propri) messaggi
];

export async function proxy(req: NextRequest) {
  if (READ_METHODS.has(req.method)) return NextResponse.next();
  const token = req.cookies.get("ft_session")?.value;
  if (!token) return NextResponse.next();
  let role: unknown;
  try {
    role = (await jwtVerify(token, SECRET)).payload.role;
  } catch {
    return NextResponse.next(); // sessione non valida: ci pensa la route (401)
  }
  if (role !== "VISUALIZZATORE") return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (ALLOWED.some((re) => re.test(path))) return NextResponse.next();
  return NextResponse.json(
    { error: "Profilo visualizzatore: accesso in sola lettura." },
    { status: 403 }
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
