import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

const MAX_LEN = 10_000;

/**
 * Modifica di una nota macchina. La nota si corregge ma non si perde: il testo
 * precedente finisce in MachineNoteRevision con chi l'ha sostituito e quando.
 * Può modificare l'autore della nota oppure chi ha `machine.edit`.
 * Nessun DELETE, di proposito: le note non sono cancellabili.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; noteId: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id, noteId } = await ctx.params;
  const note = await prisma.machineNote.findUnique({ where: { id: noteId } });
  if (!note || note.machineId !== id)
    return NextResponse.json({ error: "Nota non trovata" }, { status: 404 });

  const isAuthor = !!note.authorId && note.authorId === user.id;
  if (!isAuthor && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json(
      { error: "Puoi modificare solo le tue note (o serve il permesso di modifica fascicolo)" },
      { status: 403 }
    );

  const b = await req.json().catch(() => null);
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
