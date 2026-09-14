import { NextResponse } from "next/server";
import type { DiaryPhase } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * DELETE → elimina una foto del fascicolo.
 * Cancellazione LOGICA: la riga e il file su disco restano (deletedAt), la foto
 * sparisce da cartelle e slot, e a diario resta l'evento "Foto eliminata" con
 * chi, quando e quale foto — per ricostruire cosa è successo.
 * Agisce l'autore della foto oppure chi ha `machine.edit`.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id, photoId } = await ctx.params;
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    include: {
      componentItem: { select: { label: true, component: { select: { groupId: true, label: true } } } },
      intervento: { select: { code: true } },
    },
  });
  if (!photo || photo.machineId !== id)
    return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });
  if (photo.deletedAt) return NextResponse.json({ ok: true, alreadyDeleted: true });

  const isAuthor = !!photo.authorId && photo.authorId === user.id;
  if (!isAuthor && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json(
      { error: "Puoi eliminare solo le tue foto (o serve il permesso di modifica fascicolo)" },
      { status: 403 }
    );

  // Stessa classificazione delle cartelle della scheda Foto.
  let where: string;
  let phase: DiaryPhase = "PRODUCTION";
  if (photo.componentItemId || photo.category === "componente") {
    const c = photo.componentItem;
    where = c ? `Componenti — ${c.component.label || c.component.groupId} › ${c.label}` : "Componenti";
  } else if (photo.interventoId || photo.diaryEventId) {
    where = photo.intervento ? `Interventi — ${photo.intervento.code}` : "Interventi";
    phase = "MAINTENANCE";
  } else if (photo.category === "collaudo") {
    where = "Collaudo";
    phase = "TESTING";
  } else where = "Produzione";

  const uploaded = photo.takenAt.toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const note = [
    `Cartella: ${where}`,
    photo.caption ? `Didascalia: ${photo.caption}` : null,
    `Caricata da ${photo.authorName || "—"} il ${uploaded}`,
    `File: ${photo.path}`,
  ]
    .filter(Boolean)
    .join("\n");

  await prisma.$transaction([
    prisma.photo.update({
      where: { id: photo.id },
      data: { deletedAt: new Date(), deletedById: user.id, deletedByName: user.name },
    }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase,
        type: "note",
        title: "Foto eliminata",
        note,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
