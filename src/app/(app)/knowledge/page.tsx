import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import KnowledgeList, { type ArticleRow } from "./KnowledgeList";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "knowledge.view"))) redirect("/dashboard");
  const canManage = await userCan(user.role, "knowledge.manage");

  const rows = await prisma.knowledgeArticle.findMany({
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });

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

  return <KnowledgeList articles={articles} canManage={canManage} />;
}
