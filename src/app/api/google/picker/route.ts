import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createSession, isPickerSource, sessionState, type PickerSource } from "@/lib/googlePicker";

/**
 * Da quale libreria: la propria (`me`) o l'**archivio foto aziendale**
 * (`archive`), che e' un account collegato una volta sola in Impostazioni e
 * vale per tutti gli operatori.
 */
const sourceOf = (v: unknown): PickerSource => (isPickerSource(v) ? v : "me");

/**
 * Sessione di scelta su Google Foto.
 *
 * `POST` la apre e ritorna il link che il browser mostra all'utente;
 * `GET ?sessionId=` dice se ha finito di scegliere. Il token dell'utente resta
 * sul server: il browser non parla mai con Google, vede solo il `pickerUri`.
 */

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const b = await req.json().catch(() => null);
  const r = await createSession(user.id, sourceOf((b as { source?: unknown } | null)?.source));
  // 409 e non 500: non è un guasto, è un consenso che manca o un account da
  // collegare — la UI ci costruisce sopra il pulsante giusto.
  if ("error" in r) return NextResponse.json(r, { status: 409 });
  return NextResponse.json(r);
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const sessionId = sp.get("sessionId") ?? "";
  if (!sessionId) return NextResponse.json({ error: "sessionId mancante" }, { status: 400 });

  const r = await sessionState(user.id, sessionId, sourceOf(sp.get("source")));
  if ("error" in r) return NextResponse.json(r, { status: 409 });
  return NextResponse.json(r);
}
