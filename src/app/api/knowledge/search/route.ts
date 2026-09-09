import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { searchKnowledge } from "@/lib/brain/retrieve";

export const dynamic = "force-dynamic";

/** Ricerca full-text nei documenti indicizzati, senza passare dal modello. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  const results = await searchKnowledge(q, { audience: "internal" }, 25);
  return NextResponse.json({
    results: results.map((p) => ({
      sourceId: p.sourceId,
      title: p.source.title,
      type: p.source.type,
      breadcrumb: p.breadcrumb,
      page: p.page,
      videoAt: p.videoAt,
      filePath: p.source.filePath,
      excerpt: p.text.slice(0, 320),
      score: Math.round(p.score * 100) / 100,
    })),
  });
}
