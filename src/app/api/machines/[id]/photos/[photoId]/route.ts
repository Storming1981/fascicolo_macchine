import { NextResponse } from "next/server";
import type { DiaryPhase } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

/**
 * Foto del fascicolo.
 * DELETE               → sposta nel cestino. Cancellazione LOGICA: riga e file
 *                        su disco restano (deletedAt), la foto sparisce da
 *                        cartelle e slot.
 * PATCH {restore:true}          → ripristina dal cestino.
 * PATCH {componentItemId}       → collega (o scollega, con null) la foto a uno
 *                        slot componente: la foto scattata in officina e finita
 *                        in "Produzione" si recupera da Componenti & Matricole
 *                        invece di riscattarla. Puo' farlo chi lavora sui
 *                        componenti (`machine.intervention`), l'autore della
 *                        foto o chi ha `machine.edit`.
 * Entrambe lasciano un evento a diario (chi, quando, quale foto) per poter
 * ricostruire cosa è successo. Agisce l'autore della foto oppure chi ha
 * `machine.edit`.
 */

type Ctx = { params: Promise<{ id: string; photoId: string }> };

/** Carica la foto e verifica macchina + permesso (autore o machine.edit). */
async function authorize(ctx: Ctx, verb: string) {
  const user = await currentUser();
  if (!user) return { err: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };

  const { id, photoId } = await ctx.params;
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    include: {
      componentItem: { select: { label: true, component: { select: { groupId: true, label: true } } } },
      intervento: { select: { code: true } },
    },
  });
  if (!photo || photo.machineId !== id)
    return { err: NextResponse.json({ error: "Foto non trovata" }, { status: 404 }) };

  const isAuthor = !!photo.authorId && photo.authorId === user.id;
  if (!isAuthor && !(await userCan(user.role, "machine.edit")))
    return {
      err: NextResponse.json(
        { error: `Puoi ${verb} solo le tue foto (o serve il permesso di modifica fascicolo)` },
        { status: 403 }
      ),
    };
  return { user, photo, machineId: id };
}

type LoadedPhoto = NonNullable<Awaited<ReturnType<typeof authorize>>["photo"]>;

/** Descrizione della foto per il diario + fase (stessa logica delle cartelle). */
function describe(photo: LoadedPhoto) {
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

  const uploaded = fmtDateTime(photo.takenAt);
  const note = [
    `Cartella: ${where}`,
    photo.caption ? `Didascalia: ${photo.caption}` : null,
    `Caricata da ${photo.authorName || "—"} il ${uploaded}`,
    `File: ${photo.path}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { phase, note };
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const a = await authorize(ctx, "eliminare");
  if (a.err) return a.err;
  const { user, photo, machineId } = a;
  if (photo.deletedAt) return NextResponse.json({ ok: true, alreadyDeleted: true });

  const { phase, note } = describe(photo);
  await prisma.$transaction([
    prisma.photo.update({
      where: { id: photo.id },
      data: { deletedAt: new Date(), deletedById: user.id, deletedByName: user.name },
    }),
    prisma.diaryEvent.create({
      data: { machineId, phase, type: "note", title: "Foto eliminata", note, actorName: user.name, authorId: user.id },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const b = await req.json().catch(() => null);
  // Collegamento a uno slot: permesso suo, perche' non e' una modifica della
  // foto ma del fascicolo componenti, e la fa chi monta.
  if (b && "componentItemId" in b) return assignToSlot(ctx, b.componentItemId);

  const a = await authorize(ctx, "ripristinare");
  if (a.err) return a.err;
  const { user, photo, machineId } = a;

  if (b?.restore !== true) return NextResponse.json({ error: "Operazione non valida" }, { status: 400 });
  if (!photo.deletedAt) return NextResponse.json({ ok: true, notDeleted: true });

  const { phase, note } = describe(photo);
  const deleted = fmtDateTime(photo.deletedAt);
  await prisma.$transaction([
    prisma.photo.update({
      where: { id: photo.id },
      data: { deletedAt: null, deletedById: null, deletedByName: null },
    }),
    prisma.diaryEvent.create({
      data: {
        machineId,
        phase,
        type: "note",
        title: "Foto ripristinata dal cestino",
        note: `${note}\nEra stata eliminata da ${photo.deletedByName || "—"} il ${deleted}`,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}


/**
 * Collega una foto gia' caricata a uno slot componente (o la stacca con null).
 * La foto **si sposta** nella cartella Componenti dello slot: una foto sta in
 * un posto solo, altrimenti la stessa immagine comparirebbe due volte e non si
 * saprebbe quale delle due vale.
 */
async function assignToSlot(ctx: Ctx, itemId: unknown) {
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
  if (photo.deletedAt)
    return NextResponse.json({ error: "La foto e' nel cestino: ripristinala prima" }, { status: 409 });

  const isAuthor = !!photo.authorId && photo.authorId === user.id;
  const allowed =
    isAuthor || (await userCan(user.role, "machine.intervention")) || (await userCan(user.role, "machine.edit"));
  if (!allowed) return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const from = describe(photo).note.split("\n")[0].replace("Cartella: ", "");

  if (itemId === null) {
    await prisma.$transaction([
      prisma.photo.update({ where: { id: photo.id }, data: { componentItemId: null, category: "produzione" } }),
      prisma.diaryEvent.create({
        data: {
          machineId: id,
          phase: "PRODUCTION",
          type: "note",
          title: "Foto scollegata dallo slot",
          note: `${from} → Produzione\nFile: ${photo.path}`,
          actorName: user.name,
          authorId: user.id,
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (typeof itemId !== "string") return NextResponse.json({ error: "Slot non valido" }, { status: 400 });
  const item = await prisma.componentItem.findUnique({
    where: { id: itemId },
    include: { component: { select: { machineId: true, groupId: true, label: true } } },
  });
  if (!item || item.component.machineId !== id)
    return NextResponse.json({ error: "Slot non trovato" }, { status: 404 });

  const to = `${item.component.label || item.component.groupId} › ${item.label}`;
  await prisma.$transaction([
    prisma.photo.update({
      where: { id: photo.id },
      data: { componentItemId: item.id, category: "componente" },
    }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: "PRODUCTION",
        type: "note",
        title: `Foto collegata a ${to}`,
        note: `${from} → Componenti — ${to}\nFile: ${photo.path}`,
        actorName: user.name,
        componentRef: item.label,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true, path: photo.path });
}
