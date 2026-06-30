import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { getLivePresences } from "@/lib/presence";
import MappaClient, { type MapSite, type PlannedRow } from "./MappaClient";

export const dynamic = "force-dynamic";

export default async function MappaPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  // Cantieri attivi oggi = SOLO dove ci sono tecnici on-site adesso
  const live = await getLivePresences();
  const liveSiteIds = live.map((p) => p.siteId).filter((x): x is string => !!x);

  const sites = await prisma.site.findMany({
    where: {
      lat: { not: null },
      lng: { not: null },
      id: { in: liveSiteIds },
    },
    include: {
      customer: { select: { name: true } },
      interventi: {
        where: { status: { in: ["NUOVO", "PIANIFICATO", "IN_CORSO"] } },
        orderBy: { priority: "asc" },
        select: { id: true, code: true, title: true, status: true, priority: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const data: MapSite[] = sites.map((s) => ({
    id: s.id,
    name: s.name,
    customer: s.customer.name,
    city: s.city,
    province: s.province,
    lat: s.lat!,
    lng: s.lng!,
    status: s.status,
    interventi: s.interventi,
  }));

  // Cantieri da pianificare: interventi pianificati ai tecnici (con data)
  const plannedRows = await prisma.intervento.findMany({
    where: { status: "PIANIFICATO", scheduledStart: { not: null } },
    orderBy: { scheduledStart: "asc" },
    take: 40,
    include: {
      customer: { select: { name: true } },
      site: { select: { id: true, name: true, lat: true, lng: true } },
      tech: { select: { name: true } },
      machine: { select: { code: true, job: true } },
    },
  });
  const planned: PlannedRow[] = plannedRows.map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    customer: p.customer?.name ?? null,
    site: p.site?.name ?? null,
    siteId: p.siteId,
    lat: p.site?.lat ?? null,
    lng: p.site?.lng ?? null,
    tech: p.tech?.name ?? null,
    machine: p.machine?.job || p.machine?.code || null,
    scheduledStart: p.scheduledStart!.toISOString(),
  }));

  return <MappaClient sites={data} planned={planned} />;
}
