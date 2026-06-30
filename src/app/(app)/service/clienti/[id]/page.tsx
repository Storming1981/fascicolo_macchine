import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isErpConfigured } from "@/lib/erp";
import CustomerDetail from "./CustomerDetail";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");
  const { id } = await params;

  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      sites: { orderBy: { name: "asc" } },
      machines: { orderBy: { code: "asc" }, select: { id: true, code: true, job: true, model: true, status: true } },
      interventi: {
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, code: true, title: true, status: true, priority: true },
      },
    },
  });
  if (!c) notFound();

  const canManage = await userCan(user.role, "customer.manage");

  return (
    <CustomerDetail
      data={{
        id: c.id,
        code: c.code,
        name: c.name,
        city: c.city,
        province: c.province,
        country: c.country,
        countryCode: c.countryCode,
        contractType: c.contractType,
        phone: c.phone,
        email: c.email,
        erpConto: c.erpConto,
        sites: c.sites.map((s) => ({
          id: s.id,
          name: s.name,
          city: s.city,
          province: s.province,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          status: s.status,
        })),
        machines: c.machines,
        interventi: c.interventi,
      }}
      canManage={canManage}
      erpAvailable={isErpConfigured()}
    />
  );
}
