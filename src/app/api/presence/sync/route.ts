import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isFeedConfigured, syncStampings } from "@/lib/presenceFeed";

/** Trigger manuale del polling delle timbrature dalla web app esterna. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isFeedConfigured())
    return NextResponse.json(
      { error: "Feed timbrature non configurato (PRESENCE_FEED_URL)" },
      { status: 503 }
    );

  try {
    const result = await syncStampings();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sync timbrature";
    console.error("[presence/sync]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
