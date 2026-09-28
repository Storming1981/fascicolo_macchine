import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import {
  getRapportinoMailConfig,
  saveRapportinoMailConfig,
  getRapportinoMailState,
  pendingRapportini,
  runRapportinoMail,
} from "@/lib/rapportinoMail";

/**
 * Configurazione dell'invio automatico dei rapportini giornalieri:
 * GET  → config + esito ultimo giro + quanti sono in attesa
 * PUT  → salva la configurazione (destinatari, orario, opzioni)
 * POST → esegue il giro adesso (pulsante "Invia adesso")
 */

async function guard() {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };
  if (!(await userCan(user.role, "settings.manage")))
    return { error: NextResponse.json({ error: "Permesso negato" }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;

  const config = await getRapportinoMailConfig();
  const [state, pending] = await Promise.all([getRapportinoMailState(), pendingRapportini(config)]);
  return NextResponse.json({ config, state, pending: pending.length });
}

export async function PUT(req: Request) {
  const g = await guard();
  if (g.error) return g.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const config = await saveRapportinoMailConfig(body);
  if (config.enabled && config.to.length === 0)
    return NextResponse.json(
      { error: "Indica almeno un destinatario per attivare l'invio automatico.", config },
      { status: 400 }
    );
  return NextResponse.json({ ok: true, config });
}

export async function POST() {
  const g = await guard();
  if (g.error) return g.error;

  // force: ignora orario e "già inviato oggi" — è un invio chiesto a mano
  const result = await runRapportinoMail({ force: true });
  const state = await getRapportinoMailState();
  return NextResponse.json({ ...result, state });
}
