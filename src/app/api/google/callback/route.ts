import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import {
  isGoogleConfigured,
  exchangeCodeAndSave,
  GPHOTO_SCOPE,
  GPICKER_SCOPE,
  type GoogleTarget,
} from "@/lib/google";
import { absoluteUrl } from "@/lib/absoluteUrl";
import { returnPage, returnTarget } from "@/lib/googleReturn";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

const back = (req: Request, params: Record<string, string>, ret = "impostazioni") => {
  const qs = new URLSearchParams(params).toString();
  return NextResponse.redirect(absoluteUrl(req, `/${returnPage(ret)}?${qs}`));
};

/** Nome leggibile dei permessi in piu' che si possono chiedere. */
const SCOPE_LABEL: Record<string, string> = {
  [GPHOTO_SCOPE]: "la copia delle foto sul tuo Google Foto",
  [GPICKER_SCOPE]: "la scelta delle foto dal tuo Google Foto",
};

/**
 * Gli errori che Google rimanda nel `?error=` sono codici (`access_denied`,
 * `admin_policy_enforced`): mostrati cosi' non dicono a nessuno cosa fare.
 */
function googleErrorText(code: string): string {
  if (code === "access_denied") return "Consenso annullato nella schermata di Google: riprova e conferma.";
  if (code === "admin_policy_enforced" || code === "org_internal" || code === "disallowed_useragent")
    return (
      "L'amministratore Google Workspace dell'azienda blocca questo accesso (servizio Google Foto spento per " +
      "il tuo account o app non attendibile): va abilitato dalla console di amministrazione Google."
    );
  return `Google ha rifiutato il collegamento (${code}).`;
}

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
  const code = sp.get("code");
  const state = sp.get("state");

  // lo state deve essere il nostro, ancora valido e dello stesso utente
  let target: GoogleTarget = "me";
  let ret = "impostazioni";
  let want: string[] = [];
  try {
    if (!state) throw new Error("state mancante");
    const { payload } = await jwtVerify(state, SECRET);
    if (payload.uid !== user.id) throw new Error("state non corrispondente");
    target = payload.target === "company" ? "company" : "me";
    ret = returnTarget(typeof payload.ret === "string" ? payload.ret : null);
    want = Array.isArray(payload.want) ? payload.want.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Anche un errore di Google arriva qui: se lo state non si legge si torna
    // comunque alle impostazioni, ma il motivo vero non va perso.
    const err = sp.get("error");
    return back(req, { google: "err", msg: err ? googleErrorText(err) : "Sessione di collegamento scaduta, riprova" });
  }

  // Si torna dove si era partiti (fascicolo, profilo): prima un errore di
  // Google finiva sempre nelle impostazioni, e dal fascicolo non si vedeva.
  const err = sp.get("error");
  if (err) return back(req, { google: "err", msg: googleErrorText(err) }, ret);
  if (!code) return back(req, { google: "err", msg: "Risposta Google incompleta" }, ret);

  if (target === "company" && !(await userCan(user.role, "settings.manage")))
    return back(req, { google: "err", msg: "Permesso negato" }, ret);

  try {
    const { email, scope } = await exchangeCodeAndSave(code, target, user.id, user.name);
    // Google mostra una casella per permesso e lascia togliere la spunta: il
    // collegamento riesce lo stesso, ma senza il permesso delle foto. Senza
    // questo controllo si tornava con "collegata" e il pulsante restava
    // "Autorizza Google Foto" all'infinito, senza che nessuno capisse perche'.
    const granted = scope.split(/\s+/);
    const missing = want.filter((w) => !granted.includes(w));
    if (missing.length)
      return back(
        req,
        {
          google: "err",
          msg:
            `Casella ${email} collegata, ma Google non ha concesso ${missing.map((m) => SCOPE_LABEL[m] ?? m).join(" e ")}. ` +
            "Riprova e, nella schermata di Google, spunta la casella delle foto.",
        },
        ret
      );
    return back(req, { google: "ok", email, target }, ret);
  } catch (e) {
    return back(req, { google: "err", msg: e instanceof Error ? e.message : "Collegamento fallito" }, ret);
  }
}
