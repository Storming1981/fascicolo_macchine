import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import ClientiList, { type CustomerRow } from "./ClientiList";

export const dynamic = "force-dynamic";

export default async function ClientiPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  const canManage = await userCan(user.role, "customer.manage");
  const rows = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sites: true, interventi: true, machines: true } } },
  });

  const clienti: CustomerRow[] = rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    city: c.city,
    province: c.province,
    countryCode: c.countryCode,
    contractType: c.contractType,
    phone: c.phone,
    erpConto: c.erpConto,
    sites: c._count.sites,
    interventi: c._count.interventi,
    machines: c._count.machines,
  }));

  return <ClientiList clienti={clienti} canManage={canManage} />;
}
