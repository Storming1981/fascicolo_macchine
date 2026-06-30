import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isFeedConfigured, syncOperators } from "@/lib/presenceFeed";

/** Sincronizza l'anagrafica operatori dal timbratore (pagina /it/users). */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "users.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isFeedConfigured())
    return NextResponse.json({ error: "Timbratore non configurato" }, { status: 503 });

  try {
    const r = await syncOperators();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sync operatori";
    console.error("[users/sync-timbratore]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
