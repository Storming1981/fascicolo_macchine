import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import crypto from "crypto";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isGoogleConfigured, buildConsentUrl, type GoogleTarget } from "@/lib/google";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

/**
 * Avvia il collegamento di una casella Gmail e reindirizza al consenso Google.
 * `?target=me` (default) → casella personale dell'utente (qualsiasi utente).
 * `?target=company` → casella aziendale (richiede `settings.manage`).
 * Lo `state` è firmato (10 min) e contiene target + userId.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const target: GoogleTarget = new URL(req.url).searchParams.get("target") === "company" ? "company" : "me";
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
    nonce: crypto.randomBytes(8).toString("hex"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("600s")
    .sign(SECRET);

  return NextResponse.redirect(buildConsentUrl(state));
}
