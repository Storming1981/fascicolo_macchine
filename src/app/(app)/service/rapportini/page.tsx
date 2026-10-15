import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import RapportiniList, { type RapportinoRow } from "./RapportiniList";

export const dynamic = "force-dynamic";

/**
 * Elenco di TUTTI i rapportini giornalieri, trasversale agli interventi: prima
 * per trovarne uno bisognava indovinare in quale intervento stava e aprirlo.
 * Stessa visibilità del kanban: senza `intervento.viewAll` si vedono solo i
 * rapportini degli interventi in cui si è capo cantiere o in squadra.
 */
export default async function RapportiniPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");

  const canViewAll = await userCan(user.role, "intervento.viewAll");
  const scopeWhere = canViewAll
    ? {}
    : { OR: [{ assignedTechId: user.id }, { participants: { some: { id: user.id } } }] };

  const rows = await prisma.rapportino.findMany({
    where: { intervento: { ...scopeWhere, deletedAt: null } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      date: true,
      workDescription: true,
      issues: true,
      hoursWorked: true,
      hoursByOperator: true,
      techName: true,
      clientName: true,
      closed: true,
      sentAt: true,
      sentTo: true,
      intervento: {
        select: {
          id: true,
          code: true,
          title: true,
          type: true,
          commessa: true,
          customer: { select: { name: true } },
          site: { select: { name: true } },
          machine: { select: { code: true, job: true } },
        },
      },
      _count: { select: { attachments: true } },
    },
  });

  const rapportini: RapportinoRow[] = rows.map((r) => {
    const ops = Array.isArray(r.hoursByOperator) ? (r.hoursByOperator as { name?: string }[]) : [];
    return {
      id: r.id,
      date: r.date.toISOString(),
      workDescription: r.workDescription,
      issues: r.issues,
      hours: r.hoursWorked,
      operators: ops.map((o) => o?.name).filter((n): n is string => !!n),
      techName: r.techName,
      clientName: r.clientName,
      closed: r.closed,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      sentTo: r.sentTo,
      attachments: r._count.attachments,
      interventoId: r.intervento.id,
      interventoCode: r.intervento.code,
      interventoTitle: r.intervento.title,
      interventoType: r.intervento.type,
      commessa: r.intervento.commessa,
      customer: r.intervento.customer?.name ?? null,
      site: r.intervento.site?.name ?? null,
      machine: r.intervento.machine ? r.intervento.machine.job || r.intervento.machine.code : null,
    };
  });

  return <RapportiniList rapportini={rapportini} initialQuery={q} />;
}
