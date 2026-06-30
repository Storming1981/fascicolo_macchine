import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  if (typeof v === "string")
    return v.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12);
  return [];
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const articles = await prisma.knowledgeArticle.findMany({
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({ articles });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b.title !== "string" || !b.title.trim())
    return NextResponse.json({ error: "Titolo obbligatorio" }, { status: 400 });

  const article = await prisma.knowledgeArticle.create({
    data: {
      title: b.title.trim(),
      category: typeof b.category === "string" && b.category.trim() ? b.category.trim() : "Generale",
      tags: parseTags(b.tags),
      body: typeof b.body === "string" ? b.body : "",
      plantType: typeof b.plantType === "string" ? b.plantType.trim() || null : null,
      pinned: Boolean(b.pinned),
      authorId: user.id,
      authorName: user.name,
    },
  });
  return NextResponse.json({ ok: true, id: article.id });
}
