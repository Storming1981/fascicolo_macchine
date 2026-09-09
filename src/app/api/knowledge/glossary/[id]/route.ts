import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const data: Prisma.KnowledgeTermUpdateInput = {};
  if (typeof b.term === "string" && b.term.trim()) data.term = b.term.trim();
  if (typeof b.definition === "string") data.definition = b.definition.trim() || null;
  if (typeof b.category === "string" && b.category.trim()) data.category = b.category.trim();
  if (typeof b.plantType === "string") data.plantType = b.plantType.trim() || null;
  if (Array.isArray(b.aliases)) data.aliases = b.aliases.map(String).map((s: string) => s.trim()).filter(Boolean).slice(0, 20);
  else if (typeof b.aliases === "string")
    data.aliases = b.aliases.split(",").map((s: string) => s.trim()).filter(Boolean).slice(0, 20);

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  await prisma.knowledgeTerm.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  await prisma.knowledgeTerm.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
