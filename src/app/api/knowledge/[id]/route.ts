import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  if (typeof v === "string")
    return v.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12);
  return [];
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const data: Prisma.KnowledgeArticleUpdateInput = {};
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
  if (typeof b.category === "string" && b.category.trim()) data.category = b.category.trim();
  if (typeof b.body === "string") data.body = b.body;
  if ("tags" in b) data.tags = parseTags(b.tags);
  if (typeof b.plantType === "string") data.plantType = b.plantType.trim() || null;
  if (typeof b.pinned === "boolean") data.pinned = b.pinned;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  await prisma.knowledgeArticle.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  await prisma.knowledgeArticle.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
