import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isSheetKind } from "@/lib/allestimento";
import { moveSheet } from "@/lib/allestimentoService";

/**
 * Sposta una scheda di allestimento su un altro fascicolo (il corpo allestito a
 * magazzino che poi prende la commessa di vendita). Con la scheda viaggiano
 * matricole, foto, documenti e firma: vedi `moveSheet`.
 *
 * POST { kind, targetId }
 * Permesso: `machine.edit` — tocca due fascicoli, quindi non basta lavorare sui
 * componenti. Resta **reversibile** (si sposta indietro), per questo non e'
 * riservata ai soli amministratori come l'eliminazione del fascicolo.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { kind?: string; targetId?: string } | null;
  if (!b || !isSheetKind(b.kind))
    return NextResponse.json({ error: "Scheda non valida" }, { status: 400 });

  const r = await moveSheet(id, b.kind, String(b.targetId ?? ""), user);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
