import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import CampoInterventiList, { type CampoItem, type CampoCustomer } from "./CampoInterventiList";

export const dynamic = "force-dynamic";

export default async function CampoInterventiPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/campo/macchine");

  const canViewAll = await userCan(user.role, "intervento.viewAll");
  const canCreate = await userCan(user.role, "intervento.create");
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

  // Anagrafica minima per la creazione da campo (solo se l'utente può creare)
  let customers: CampoCustomer[] = [];
  if (canCreate) {
    const cs = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sites: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        machines: { select: { id: true, code: true, job: true }, orderBy: { job: "asc" } },
      },
    });
    customers = cs.map((c) => ({
      id: c.id,
      name: c.name,
      sites: c.sites,
      machines: c.machines.map((m) => ({ id: m.id, label: m.job || m.code })),
    }));
  }

  return (
    <CampoInterventiList
      items={items}
      own={!canViewAll}
      canCreate={canCreate}
      customers={customers}
    />
  );
}
