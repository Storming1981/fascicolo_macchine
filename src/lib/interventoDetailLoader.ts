import { prisma } from "./db";

/**
 * Carica i dati della scheda intervento (dto + tecnici + macchine + commesse
 * timbrate). Condiviso tra il guscio desktop e l'app Campo.
 */
export async function loadInterventoDetail(id: string) {
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          sites: { orderBy: { name: "asc" }, select: { id: true, name: true } },
        },
      },
      site: { select: { id: true, name: true, city: true } },
      machine: { select: { id: true, code: true, job: true, model: true } },
      tech: { select: { id: true, name: true } },
      participants: { select: { id: true, name: true } },
      rapportini: {
        orderBy: { date: "asc" },
        include: {
          revisions: { orderBy: { editedAt: "desc" } },
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
      checklists: true,
      documents: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true } } } },
      photos: { orderBy: { createdAt: "desc" } },
      conversations: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
    },
  });
  if (!intervento) return null;

  const [techs, machines, commesseRows] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: [{ siteManager: "desc" }, { name: "asc" }],
      select: { id: true, name: true, zona: true, siteManager: true },
    }),
    prisma.machine.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, job: true, customer: true, customerId: true },
    }),
    prisma.techPresence.findMany({
      where: { commessa: { not: null } },
      select: { commessa: true, site: { select: { city: true, customer: { select: { name: true } } } } },
      orderBy: { clockIn: "desc" },
    }),
  ]);


  const commMap = new Map<string, string>();
  for (const r of commesseRows) {
    if (!r.commessa || commMap.has(r.commessa)) continue;
    commMap.set(r.commessa, [r.site?.customer?.name, r.site?.city].filter(Boolean).join(" · "));
  }
  const commesse = [...commMap.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const dto = {
    id: intervento.id,
    code: intervento.code,
    title: intervento.title,
    description: intervento.description,
    commessa: intervento.commessa,
    status: intervento.status,
    type: intervento.type,
    priority: intervento.priority,
    channel: intervento.channel,
    reportedBy: intervento.reportedBy,
    deletedAt: intervento.deletedAt?.toISOString() ?? null,
    deletedByName: intervento.deletedByName,
    chatId: intervento.conversations[0]?.id ?? null,
    customerId: intervento.customerId,
    customerName: intervento.customer?.name ?? null,
    customerEmail: intervento.customer?.email ?? null,
    customerSites: intervento.customer?.sites ?? [],
    siteId: intervento.siteId,
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
    participants: intervento.participants.map((p) => ({ id: p.id, name: p.name })),
    scheduledStart: intervento.scheduledStart?.toISOString() ?? null,
    scheduledEnd: intervento.scheduledEnd?.toISOString() ?? null,
    completedAt: intervento.completedAt?.toISOString() ?? null,
    checklists: intervento.checklists.map((c) => ({
      type: c.type,
      closed: c.closed,
      pdfPath: c.pdfPath,
      compiledAt: c.compiledAt?.toISOString() ?? null,
      compilerName: c.compilerName,
      clientName: c.clientName,
      answers: (c.answers as Record<string, string>) ?? {},
      fields: (c.fields as Record<string, string>) ?? {},
      revisionsCount: Array.isArray(c.revisions) ? (c.revisions as unknown[]).length : 0,
    })),
    documents: intervento.documents.map((d) => ({
      id: d.id,
      name: d.name,
      path: d.path,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      category: d.category,
      source: d.source,
      userName: d.user?.name ?? null,
      uploadedByName: d.uploadedByName,
      createdAt: d.createdAt.toISOString(),
    })),
    photos: intervento.photos.map((p) => ({ id: p.id, path: p.path, caption: p.caption })),
    rapportini: intervento.rapportini.map((r) => ({
      id: r.id,
      date: r.date.toISOString(),
      workDescription: r.workDescription,
      issues: r.issues,
      ricambi: (r.ricambi as { code: string; desc: string; qty: string; note: string }[]) ?? [],
      hoursWorked: r.hoursWorked,
      plantHours: r.plantHours,
      hoursByOperator:
        (r.hoursByOperator as { name: string; matricola?: string | null; hours: number }[]) ?? [],
      timbrature:
        (r.timbrature as {
          name: string;
          start: string;
          end: string;
          hours?: number | null;
          manual?: boolean;
          orig?: { name: string; start: string; end: string };
        }[]) ?? [],
      attachments: r.attachments.map((a) => ({
        id: a.id,
        path: a.path,
        filename: a.filename,
        mime: a.mime,
        kind: a.kind,
      })),
      pdfPath: r.pdfPath,
      authorId: r.authorId,
      techName: r.techName,
      techSignature: r.techSignature,
      clientName: r.clientName,
      clientSignature: r.clientSignature,
      closed: r.closed,
      sentAt: r.sentAt?.toISOString() ?? null,
      sentTo: r.sentTo,
      diaryEventId: r.diaryEventId,
      hash: r.hash,
      revisions: r.revisions.map((rev) => ({
        id: rev.id,
        editedAt: rev.editedAt.toISOString(),
        editedByName: rev.editedByName,
        note: rev.note,
        snapshot: rev.snapshot as {
          date?: string;
          workDescription?: string | null;
          hoursWorked?: number | null;
          techName?: string | null;
          clientName?: string | null;
        } | null,
      })),
    })),
  };

  return { dto, techs, machines, commesse };
}
