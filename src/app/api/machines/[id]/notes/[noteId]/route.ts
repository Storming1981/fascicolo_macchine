import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

const MAX_LEN = 10_000;

/**
 * Nota macchina singola.
 * PATCH  { text }         → modifica: il testo precedente va in MachineNoteRevision.
 * PATCH  { restore: true } → ripristina dal cestino.
 * DELETE                  → sposta nel cestino (cancellazione LOGICA: deletedAt).
 *                           La nota resta nel DB, visibile nel Cestino.
 * Agisce l'autore della nota oppure chi ha `machine.edit`.
 */

type Ctx = { params: Promise<{ id: string; noteId: string }> };

/** Carica la nota e verifica macchina + permesso (autore o machine.edit). */
async function authorize(ctx: Ctx, verb: string) {
  const user = await currentUser();
  if (!user) return { err: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };

  const { id, noteId } = await ctx.params;
  const note = await prisma.machineNote.findUnique({ where: { id: noteId } });
  if (!note || note.machineId !== id)
    return { err: NextResponse.json({ error: "Nota non trovata" }, { status: 404 }) };

  const isAuthor = !!note.authorId && note.authorId === user.id;
  if (!isAuthor && !(await userCan(user.role, "machine.edit")))
    return {
      err: NextResponse.json(
        { error: `Puoi ${verb} solo le tue note (o serve il permesso di modifica fascicolo)` },
        { status: 403 }
      ),
    };
  return { user, note };
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const a = await authorize(ctx, "cancellare");
  if (a.err) return a.err;
  const { user, note } = a;
  if (note.deletedAt) return NextResponse.json({ ok: true, alreadyDeleted: true });

  await prisma.machineNote.update({
    where: { id: note.id },
    data: { deletedAt: new Date(), deletedById: user.id, deletedByName: user.name },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await authorize(ctx, "modificare");
  if (a.err) return a.err;
  const { user, note } = a;
  const noteId = note.id;

  const b = await req.json().catch(() => null);

  if (b?.restore === true) {
    if (!note.deletedAt) return NextResponse.json({ ok: true, notDeleted: true });
    await prisma.machineNote.update({
      where: { id: noteId },
      data: { deletedAt: null, deletedById: null, deletedByName: null },
    });
    return NextResponse.json({ ok: true });
  }

  if (note.deletedAt)
    return NextResponse.json(
      { error: "La nota è nel cestino: ripristinala prima di modificarla" },
      { status: 409 }
    );

  const text = typeof b?.text === "string" ? b.text.trim() : "";
  if (!text) return NextResponse.json({ error: "La nota non può restare vuota" }, { status: 400 });
  if (text.length > MAX_LEN)
    return NextResponse.json({ error: `Nota troppo lunga (max ${MAX_LEN} caratteri)` }, { status: 400 });
  if (text === note.text) return NextResponse.json({ ok: true, unchanged: true });

  const now = new Date();
  await prisma.$transaction([
    prisma.machineNoteRevision.create({
      data: { noteId, text: note.text, editedById: user.id, editedByName: user.name, editedAt: now },
    }),
    prisma.machineNote.update({
      where: { id: noteId },
      data: { text, editedById: user.id, editedByName: user.name, editedAt: now },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
