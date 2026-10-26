import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createSession, sessionState } from "@/lib/googlePicker";

/**
 * Sessione di scelta su Google Foto.
 *
 * `POST` la apre e ritorna il link che il browser mostra all'utente;
 * `GET ?sessionId=` dice se ha finito di scegliere. Il token dell'utente resta
 * sul server: il browser non parla mai con Google, vede solo il `pickerUri`.
 */

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const r = await createSession(user.id);
  // 409 e non 500: non è un guasto, è un consenso che manca o un account da
  // collegare — la UI ci costruisce sopra il pulsante giusto.
  if ("error" in r) return NextResponse.json(r, { status: 409 });
  return NextResponse.json(r);
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!sessionId) return NextResponse.json({ error: "sessionId mancante" }, { status: 400 });

  const r = await sessionState(user.id, sessionId);
  if ("error" in r) return NextResponse.json(r, { status: 409 });
  return NextResponse.json(r);
}
