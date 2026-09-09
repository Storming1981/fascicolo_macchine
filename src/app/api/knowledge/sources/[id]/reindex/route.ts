import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { indexSource } from "@/lib/brain/indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rilegge il documento e ricostruisce l'indice (utile dopo un OCR fallito). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const result = await indexSource(id, { force: true });
  return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 422 });
}
