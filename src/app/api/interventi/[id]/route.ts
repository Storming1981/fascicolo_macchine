import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isClosedStatus } from "@/lib/interventoService";
import { INTERVENTO_TYPE_META } from "@/lib/domain";
import { POS_BLOCK_MESSAGE, touchesPlanning } from "@/lib/pos";
import type { InterventoStatus, Prisma } from "@prisma/client";

const STATUSES: InterventoStatus[] = [
  "DOCUMENTAZIONE",
  "NUOVO",
  "PIANIFICATO",
  "IN_CORSO",
  "COMPLETATO",
  "FATTURATO",
];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  // ── Vincolo P.O.S. ────────────────────────────────────────────────
  // Finché il Piano Operativo di Sicurezza non è caricato e validato dal
  // responsabile (flag + firma), l'intervento non si assegna, non si pianifica
  // e non esce dallo stato "Documentazione da validare".
  const current = await prisma.intervento.findUnique({
    where: { id },
    select: { posValidated: true, status: true },
  });
  if (!current) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });
  if (!current.posValidated) {
    if (touchesPlanning(b))
      return NextResponse.json({ error: POS_BLOCK_MESSAGE }, { status: 409 });
    if (b.status && STATUSES.includes(b.status) && b.status !== "DOCUMENTAZIONE")
      return NextResponse.json(
        { error: `${POS_BLOCK_MESSAGE} L'intervento resta in "Documentazione da validare".` },
        { status: 409 }
      );
  }

  const data: Prisma.InterventoUpdateInput = {};
  if (b.status && STATUSES.includes(b.status)) {
    data.status = b.status as InterventoStatus;
    if (b.status === "IN_CORSO") data.startedAt = new Date();
    if (isClosedStatus(b.status)) data.completedAt = new Date();
    if (b.status === "FATTURATO") data.invoicedAt = new Date();
  }
  if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
  if (typeof b.description === "string") data.description = b.description.trim() || null;
  if (typeof b.type === "string" && b.type in INTERVENTO_TYPE_META) data.type = b.type;
  if (typeof b.commessa === "string") data.commessa = b.commessa.trim() || null;
  if ([1, 2, 3].includes(b.priority)) data.priority = b.priority;
  if ("assignedTechId" in b)
    data.tech = b.assignedTechId
      ? { connect: { id: b.assignedTechId } }
      : { disconnect: true };
  if ("machineId" in b)
    data.machine = b.machineId ? { connect: { id: b.machineId } } : { disconnect: true };
  if ("customerId" in b)
    data.customer = b.customerId ? { connect: { id: b.customerId } } : { disconnect: true };
  if ("siteId" in b)
    data.site = b.siteId ? { connect: { id: b.siteId } } : { disconnect: true };
  if (typeof b.reportedBy === "string") data.reportedBy = b.reportedBy.trim() || null;
  if (Array.isArray(b.participantIds)) {
    const ids = (b.participantIds as unknown[])
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      // il supervisore non può essere anche partecipante
      .filter((x) => x !== (b.assignedTechId ?? undefined));
    data.participants = { set: ids.map((id) => ({ id })) };
  }
  if (b.scheduledStart !== undefined)
    data.scheduledStart = b.scheduledStart ? new Date(b.scheduledStart) : null;
  if (b.scheduledEnd !== undefined)
    data.scheduledEnd = b.scheduledEnd ? new Date(b.scheduledEnd) : null;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  const intervento = await prisma.intervento.update({ where: { id }, data });
  return NextResponse.json({ ok: true, code: intervento.code });
}
