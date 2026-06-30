import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { nextInterventoCode } from "@/lib/interventoService";
import type { InterventoStatus, Prisma } from "@prisma/client";

const STATUSES: InterventoStatus[] = [
  "NUOVO",
  "PIANIFICATO",
  "IN_CORSO",
  "COMPLETATO",
  "FATTURATO",
];

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const where: Prisma.InterventoWhereInput = {};
  const status = searchParams.get("status");
  if (status && STATUSES.includes(status as InterventoStatus))
    where.status = status as InterventoStatus;
  const tech = searchParams.get("tech");
  if (tech) where.assignedTechId = tech;

  const interventi = await prisma.intervento.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    include: {
      customer: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      machine: { select: { id: true, code: true } },
      tech: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ interventi });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.create")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b.title !== "string" || !b.title.trim())
    return NextResponse.json({ error: "Titolo obbligatorio" }, { status: 400 });

  const code = await nextInterventoCode();
  const priority = [1, 2, 3].includes(b.priority) ? b.priority : 3;
  const status: InterventoStatus = STATUSES.includes(b.status) ? b.status : "NUOVO";

  const intervento = await prisma.intervento.create({
    data: {
      code,
      title: b.title.trim(),
      description: typeof b.description === "string" ? b.description.trim() || null : null,
      status,
      priority,
      channel: typeof b.channel === "string" ? b.channel.trim() || null : null,
      reportedBy: typeof b.reportedBy === "string" ? b.reportedBy.trim() || null : null,
      customerId: b.customerId || null,
      siteId: b.siteId || null,
      machineId: b.machineId || null,
      assignedTechId: b.assignedTechId || null,
      scheduledStart: b.scheduledStart ? new Date(b.scheduledStart) : null,
      scheduledEnd: b.scheduledEnd ? new Date(b.scheduledEnd) : null,
    },
  });
  return NextResponse.json({ ok: true, id: intervento.id, code });
}
