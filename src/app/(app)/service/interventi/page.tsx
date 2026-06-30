import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import InterventiBoard, { type InterventoRow, type CustomerOpt } from "./InterventiBoard";

export const dynamic = "force-dynamic";

export default async function InterventiPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  const canCreate = await userCan(user.role, "intervento.create");
  const canEdit = await userCan(user.role, "intervento.edit");

  const [rows, techs, customerRows] = await Promise.all([
    prisma.intervento.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      include: {
        customer: { select: { name: true } },
        site: { select: { name: true } },
        machine: { select: { code: true, job: true } },
        tech: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, zona: true },
    }),
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sites: { orderBy: { name: "asc" }, select: { id: true, name: true } },
        machines: { orderBy: { code: "asc" }, select: { id: true, code: true, job: true, model: true } },
      },
    }),
  ]);

  const customers: CustomerOpt[] = customerRows.map((c) => ({
    id: c.id,
    name: c.name,
    sites: c.sites,
    machines: c.machines,
  }));

  const interventi: InterventoRow[] = rows.map((i) => ({
    id: i.id,
    code: i.code,
    title: i.title,
    status: i.status,
    priority: i.priority,
    channel: i.channel,
    customer: i.customer?.name ?? null,
    site: i.site?.name ?? null,
    machineCode: i.machine?.code ?? null,
    machineJob: i.machine?.job ?? null,
    tech: i.tech?.name ?? null,
    assignedTechId: i.assignedTechId,
    scheduledStart: i.scheduledStart ? i.scheduledStart.toISOString() : null,
  }));

  return (
    <InterventiBoard
      interventi={interventi}
      techs={techs}
      customers={customers}
      canCreate={canCreate}
      canEdit={canEdit}
    />
  );
}
