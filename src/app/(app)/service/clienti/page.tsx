import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import ClientiList, { type CustomerRow, type PortalAccess } from "./ClientiList";

export const dynamic = "force-dynamic";

export default async function ClientiPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  const canManage = await userCan(user.role, "customer.manage");
  const [rows, portalUsers] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { sites: true, interventi: true, machines: true } } },
    }),
    // Accesso al portale = utente con ruolo CLIENTE agganciato al cliente
    // (vedi /api/clienti/[id]/portal-access). Una query sola per tutti.
    prisma.user.findMany({
      where: { role: "CLIENTE", customerId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { customerId: true, email: true, active: true, createdAt: true },
    }),
  ]);

  const portalByCustomer = new Map<string, PortalAccess>();
  for (const u of portalUsers) {
    const prev = portalByCustomer.get(u.customerId!);
    // se ci fossero piu' accessi, vince quello attivo (poi il piu' vecchio)
    if (prev && (prev.active || !u.active)) continue;
    portalByCustomer.set(u.customerId!, {
      email: u.email,
      active: u.active,
      since: u.createdAt.toISOString(),
    });
  }

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
    portal: portalByCustomer.get(c.id) ?? null,
  }));

  return <ClientiList clienti={clienti} canManage={canManage} />;
}
