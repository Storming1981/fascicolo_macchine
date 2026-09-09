import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { indexSource } from "@/lib/brain/indexer";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dettaglio di una fonte, con l'anteprima dei chunk indicizzati. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const source = await prisma.knowledgeSource.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { seq: "asc" },
        take: 40,
        select: { id: true, seq: true, breadcrumb: true, page: true, text: true, tokens: true, videoAt: true },
      },
    },
  });
  if (!source) return NextResponse.json({ error: "Fonte non trovata" }, { status: 404 });
  return NextResponse.json({ source });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const data: Prisma.KnowledgeSourceUpdateInput = {};
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
  if (typeof b.description === "string") data.description = b.description || null;
  if (typeof b.plantType === "string") data.plantType = b.plantType.trim() || null;
  if (typeof b.model === "string") data.model = b.model.trim() || null;
  if (b.visibility === "CUSTOMER" || b.visibility === "INTERNAL") data.visibility = b.visibility;
  if (Array.isArray(b.tags)) data.tags = b.tags.map(String).filter(Boolean).slice(0, 12);
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  await prisma.knowledgeSource.update({ where: { id }, data });

  // Titolo e descrizione finiscono nei chunk (breadcrumb e primo blocco):
  // se cambiano, l'indice va rifatto o le citazioni resterebbero sbagliate.
  const reindex = "title" in data || "description" in data;
  const result = reindex ? await indexSource(id, { force: true }) : null;
  return NextResponse.json({ ok: true, reindexed: reindex, result });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  // I chunk cadono in cascata; il file su disco resta (storico degli upload).
  await prisma.knowledgeSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
