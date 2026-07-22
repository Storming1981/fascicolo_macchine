import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isGoogleConfigured, exchangeCodeAndSave, type GoogleTarget } from "@/lib/google";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

const back = (req: Request, params: Record<string, string>) => {
  const u = new URL("/impostazioni", req.url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
};

/**
 * Callback OAuth Google: verifica lo `state`, scambia il code con i token e li
 * salva sul bersaglio (personale dell'utente o aziendale). Torna su /impostazioni.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!isGoogleConfigured()) return back(req, { google: "err", msg: "Google non configurato" });

  const sp = new URL(req.url).searchParams;
  const err = sp.get("error");
  if (err) return back(req, { google: "err", msg: err });

  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return back(req, { google: "err", msg: "Risposta Google incompleta" });

  // lo state deve essere il nostro, ancora valido e dello stesso utente
  let target: GoogleTarget = "me";
  try {
    const { payload } = await jwtVerify(state, SECRET);
    if (payload.uid !== user.id) throw new Error("state non corrispondente");
    target = payload.target === "company" ? "company" : "me";
  } catch {
    return back(req, { google: "err", msg: "Sessione di collegamento scaduta, riprova" });
  }

  if (target === "company" && !(await userCan(user.role, "settings.manage")))
    return back(req, { google: "err", msg: "Permesso negato" });

  try {
    const email = await exchangeCodeAndSave(code, target, user.id, user.name);
    return back(req, { google: "ok", email, target });
  } catch (e) {
    return back(req, { google: "err", msg: e instanceof Error ? e.message : "Collegamento fallito" });
  }
}
