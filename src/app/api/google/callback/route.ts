import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isGoogleConfigured, exchangeCodeAndSave, type GoogleTarget } from "@/lib/google";
import { absoluteUrl } from "@/lib/absoluteUrl";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

const back = (req: Request, params: Record<string, string>, ret = "impostazioni") => {
  const qs = new URLSearchParams(params).toString();
  const page = ret === "profilo" ? "profilo" : "impostazioni";
  return NextResponse.redirect(absoluteUrl(req, `/${page}?${qs}`));
};

/**
 * Callback OAuth Google: verifica lo `state`, scambia il code con i token e li
 * salva sul bersaglio (personale dell'utente o aziendale). Torna su /impostazioni
 * o su /profilo, a seconda di dove era partito il collegamento.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(absoluteUrl(req, "/login"));
  if (!isGoogleConfigured()) return back(req, { google: "err", msg: "Google non configurato" });

  const sp = new URL(req.url).searchParams;
  const err = sp.get("error");
  if (err) return back(req, { google: "err", msg: err });

  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return back(req, { google: "err", msg: "Risposta Google incompleta" });

  // lo state deve essere il nostro, ancora valido e dello stesso utente
  let target: GoogleTarget = "me";
  let ret = "impostazioni";
  try {
    const { payload } = await jwtVerify(state, SECRET);
    if (payload.uid !== user.id) throw new Error("state non corrispondente");
    target = payload.target === "company" ? "company" : "me";
    ret = payload.ret === "profilo" ? "profilo" : "impostazioni";
  } catch {
    return back(req, { google: "err", msg: "Sessione di collegamento scaduta, riprova" });
  }

  if (target === "company" && !(await userCan(user.role, "settings.manage")))
    return back(req, { google: "err", msg: "Permesso negato" }, ret);

  try {
    const email = await exchangeCodeAndSave(code, target, user.id, user.name);
    return back(req, { google: "ok", email, target }, ret);
  } catch (e) {
    return back(req, { google: "err", msg: e instanceof Error ? e.message : "Collegamento fallito" }, ret);
  }
}
