import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import ArticleView from "./ArticleView";

export const dynamic = "force-dynamic";

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "knowledge.view"))) redirect("/dashboard");
  const { id } = await params;

  const a = await prisma.knowledgeArticle.findUnique({ where: { id } });
  if (!a) notFound();
  const canManage = await userCan(user.role, "knowledge.manage");

  return (
    <ArticleView
      article={{
        id: a.id,
        title: a.title,
        category: a.category,
        tags: a.tags,
        plantType: a.plantType,
        body: a.body,
        pinned: a.pinned,
        authorName: a.authorName,
        updatedAt: a.updatedAt.toISOString(),
      }}
      canManage={canManage}
    />
  );
}
