import { NextResponse } from "next/server";

/** Riceve errori/diagnostica dal browser e li scrive nei log del server. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    // Compare in `docker compose logs app`
    console.error("[client]", JSON.stringify(b).slice(0, 2000));
  } catch {
    /* ignora payload malformati */
  }
  return NextResponse.json({ ok: true });
}
