import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Firma unica del riepilogo intervento (tutte le giornate in un PDF solo).
 * POST { techName, techSignature, clientName, clientSignature } → firma;
 * DELETE → revoca la firma (il PDF resta stampabile, ma senza firme).
 * Le firme sono dataURL: piccole, e restano legate all'intervento.
 */
const sig = (v: unknown): string | null =>
  typeof v === "string" && v.startsWith("data:image") && v.length < 400_000 ? v : null;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const it = await prisma.intervento.findUnique({
    where: { id },
    select: { id: true, rapportini: { select: { id: true }, take: 1 } },
  });
  if (!it) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });
  if (!it.rapportini.length)
    return NextResponse.json({ error: "Nessuna giornata da riepilogare" }, { status: 400 });

  const b = await req.json().catch(() => null);
  const techSignature = sig(b?.techSignature);
  const clientSignature = sig(b?.clientSignature);
  if (!techSignature && !clientSignature)
    return NextResponse.json({ error: "Serve almeno una firma." }, { status: 400 });

  await prisma.intervento.update({
    where: { id },
    data: {
      summaryTechName: String(b?.techName ?? "").trim().slice(0, 120) || user.name,
      summaryTechSignature: techSignature,
      summaryClientName: String(b?.clientName ?? "").trim().slice(0, 120) || null,
      summaryClientSignature: clientSignature,
      summarySignedAt: new Date(),
      summarySignedByName: user.name,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  await prisma.intervento.update({
    where: { id },
    data: {
      summaryTechName: null,
      summaryTechSignature: null,
      summaryClientName: null,
      summaryClientSignature: null,
      summarySignedAt: null,
      summarySignedByName: null,
    },
  });
  return NextResponse.json({ ok: true });
}
