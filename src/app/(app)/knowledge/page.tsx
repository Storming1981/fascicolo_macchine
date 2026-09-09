import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isBrainConfigured } from "@/lib/brain/config";
import KnowledgeHome from "./KnowledgeHome";
import type { ArticleRow } from "./KnowledgeList";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "knowledge.view"))) redirect("/dashboard");

  const [canManage, canAsk] = await Promise.all([
    userCan(user.role, "knowledge.manage"),
    userCan(user.role, "knowledge.ask"),
  ]);

  const [rows, sources, chunks, terms] = await Promise.all([
    prisma.knowledgeArticle.findMany({ orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }),
    prisma.knowledgeSource.count({ where: { status: "READY" } }),
    prisma.knowledgeChunk.count(),
    prisma.knowledgeTerm.count(),
  ]);

  const articles: ArticleRow[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    category: a.category,
    tags: a.tags,
    pinned: a.pinned,
    plantType: a.plantType,
    excerpt: a.body.slice(0, 160),
    updatedAt: a.updatedAt.toISOString(),
  }));

  return (
    <KnowledgeHome
      articles={articles}
      canManage={canManage}
      canAsk={canAsk}
      brainConfigured={isBrainConfigured()}
      counts={{ sources, chunks, terms }}
    />
  );
}
