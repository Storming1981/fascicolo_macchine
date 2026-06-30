import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { recordPresence } from "@/lib/presence";

/**
 * Ingest timbrature presenze.
 *
 * Due modalità:
 *  - Feed esterno: header `x-presence-key` == env PRESENCE_INGEST_KEY (no sessione).
 *    Accetta anche un array di eventi per batch.
 *  - Manuale: sessione con permesso `intervento.edit`.
 *
 * Evento: { userId? | badge? | email? | name?, commessa?, siteId?, event:"in"|"out", at? }
 */
export async function POST(req: Request) {
  const key = process.env.PRESENCE_INGEST_KEY;
  const provided = req.headers.get("x-presence-key");
  const externalOk = Boolean(key && provided && provided === key);

  let source = "external";
  if (!externalOk) {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
    if (!(await userCan(user.role, "intervento.edit")))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
    source = "manual";
  }

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const events = Array.isArray(b) ? b : [b];
  const results = [];
  for (const e of events) {
    if (e?.event !== "in" && e?.event !== "out") {
      results.push({ ok: false, reason: "event deve essere 'in' o 'out'" });
      continue;
    }
    const r = await recordPresence({
      userId: typeof e.userId === "string" ? e.userId : null,
      badge: typeof e.badge === "string" ? e.badge : null,
      matricola: typeof e.matricola === "string" ? e.matricola : null,
      email: typeof e.email === "string" ? e.email : null,
      name: typeof e.name === "string" ? e.name : null,
      commessa: typeof e.commessa === "string" ? e.commessa : null,
      siteId: typeof e.siteId === "string" ? e.siteId : null,
      event: e.event,
      at: e.at ? new Date(e.at) : null,
      source: e.source ?? source,
      note: typeof e.note === "string" ? e.note : null,
    });
    results.push(r);
  }

  return NextResponse.json({ ok: true, results });
}
