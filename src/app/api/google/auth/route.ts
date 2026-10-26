import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import crypto from "crypto";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import {
  isGoogleConfigured,
  buildConsentUrl,
  GOOGLE_SCOPES,
  GPHOTO_SCOPE,
  GPICKER_SCOPE,
  type GoogleTarget,
} from "@/lib/google";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { returnTarget } from "@/lib/googleReturn";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

/**
 * Avvia il collegamento di una casella Gmail e reindirizza al consenso Google.
 * `?target=me` (default) → casella personale dell'utente (qualsiasi utente).
 * `?target=company` → casella aziendale (richiede `settings.manage`).
 * Lo `state` è firmato (10 min) e contiene target + userId.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(absoluteUrl(req, "/login"));

  const sp = new URL(req.url).searchParams;
  const target: GoogleTarget = sp.get("target") === "company" ? "company" : "me";
  // Pagina a cui tornare dopo il consenso. Elenco chiuso (piu' il fascicolo,
  // col solo codice macchina): il valore finisce in una redirect, e accettare
  // un path qualunque vorrebbe dire farsi spedire gli utenti dove capita.
  const ret = returnTarget(sp.get("return"));
  if (target === "company" && !(await userCan(user.role, "settings.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  if (!isGoogleConfigured())
    return NextResponse.json(
      { error: "Google non configurato: mancano GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI." },
      { status: 503 }
    );

  const state = await new SignJWT({
    uid: user.id,
    name: user.name,
    target,
    ret,
    nonce: crypto.randomBytes(8).toString("hex"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("600s")
    .sign(SECRET);

  // `?photos=1` (copia su Google Foto) e `?picker=1` (pesca dal proprio Google
  // Foto) chiedono permessi in piu', uno per volta e solo a chi li attiva: chi
  // collega la casella per spedire non deve vedersi chiedere le proprie foto.
  const extra = [sp.get("photos") === "1" ? GPHOTO_SCOPE : "", sp.get("picker") === "1" ? GPICKER_SCOPE : ""]
    .filter(Boolean)
    .join(" ");
  return NextResponse.redirect(buildConsentUrl(state, extra ? `${GOOGLE_SCOPES} ${extra}` : GOOGLE_SCOPES));
}
