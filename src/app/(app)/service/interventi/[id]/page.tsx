import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import InterventoDetail from "./InterventoDetail";

export const dynamic = "force-dynamic";

export default async function InterventoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");
  const { id } = await params;

  const intervento = await prisma.intervento.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      site: { select: { id: true, name: true, city: true } },
      machine: { select: { id: true, code: true, job: true, model: true } },
      tech: { select: { id: true, name: true } },
      rapportino: true,
      photos: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!intervento) notFound();

  const [techs, machines] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, zona: true },
    }),
    prisma.machine.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, job: true, customer: true },
    }),
  ]);

  const canEdit = await userCan(user.role, "intervento.edit");
  const canSign = await userCan(user.role, "intervento.sign");

  const r = intervento.rapportino;
  const dto = {
    id: intervento.id,
    code: intervento.code,
    title: intervento.title,
    description: intervento.description,
    status: intervento.status,
    priority: intervento.priority,
    channel: intervento.channel,
    reportedBy: intervento.reportedBy,
    customerName: intervento.customer?.name ?? null,
    siteName: intervento.site?.name ?? null,
    machine: intervento.machine
      ? {
          id: intervento.machine.id,
          code: intervento.machine.code,
          job: intervento.machine.job,
          model: intervento.machine.model,
        }
      : null,
    techId: intervento.assignedTechId,
    scheduledStart: intervento.scheduledStart?.toISOString() ?? null,
    completedAt: intervento.completedAt?.toISOString() ?? null,
    photos: intervento.photos.map((p) => ({ id: p.id, path: p.path, caption: p.caption })),
    rapportino: r
      ? {
          workDescription: r.workDescription,
          ricambi: (r.ricambi as { code: string; desc: string; qty: string; note: string }[]) ?? [],
          hoursWorked: r.hoursWorked,
          techName: r.techName,
          techSignature: r.techSignature,
          clientName: r.clientName,
          clientSignature: r.clientSignature,
          closed: r.closed,
          diaryEventId: r.diaryEventId,
          hash: r.hash,
        }
      : null,
  };

  return (
    <InterventoDetail
      data={dto}
      techs={techs}
      machines={machines}
      currentUserName={user.name}
      canEdit={canEdit}
      canSign={canSign}
    />
  );
}
