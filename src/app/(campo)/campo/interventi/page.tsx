import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import CampoInterventiList, { type CampoItem } from "./CampoInterventiList";

export const dynamic = "force-dynamic";

export default async function CampoInterventiPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/campo/macchine");

  const canViewAll = await userCan(user.role, "intervento.viewAll");
  const where = canViewAll
    ? {}
    : { OR: [{ assignedTechId: user.id }, { participants: { some: { id: user.id } } }] };

  const rows = await prisma.intervento.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    include: {
      customer: { select: { name: true } },
      site: { select: { name: true } },
      machine: { select: { code: true, job: true } },
    },
  });

  const items: CampoItem[] = rows.map((i) => ({
    id: i.id,
    code: i.code,
    title: i.title,
    status: i.status,
    type: i.type,
    priority: i.priority,
    customer: i.customer?.name ?? null,
    site: i.site?.name ?? null,
    machineJob: i.machine?.job ?? i.machine?.code ?? null,
  }));

  return <CampoInterventiList items={items} own={!canViewAll} />;
}
