import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { syncCorpus } from "@/lib/brain/corpus";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reindicizza il corpus operativo (rapportini, chat, diari, articoli).
 * Idempotente: rifà solo cio' che e' cambiato dall'ultima volta.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const result = await syncCorpus();
  return NextResponse.json({ ok: true, result });
}
