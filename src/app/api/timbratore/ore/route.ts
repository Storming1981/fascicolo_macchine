import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isFeedConfigured, fetchCommessaHours } from "@/lib/presenceFeed";

/** Ore timbrate su una commessa (per giorno + totale). Query: ?commessa=&from=&to= */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isFeedConfigured())
    return NextResponse.json({ error: "Timbratore non configurato", total: 0, byDay: {} }, { status: 503 });

  const sp = new URL(req.url).searchParams;
  const commessa = (sp.get("commessa") ?? "").trim();
  if (!commessa) return NextResponse.json({ error: "commessa mancante", total: 0, byDay: {} }, { status: 400 });

  try {
    const data = await fetchCommessaHours(commessa, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore timbratore", total: 0, byDay: {} },
      { status: 502 }
    );
  }
}
