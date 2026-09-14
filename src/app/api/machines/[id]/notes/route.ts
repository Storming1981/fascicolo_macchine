import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

const MAX_LEN = 10_000;

/**
 * Note della macchina (settaggi particolari, aggiustaggi dedicati, appunti).
 * POST → nuova nota firmata con utente + data/ora.
 * La cancellazione è logica (cestino, ripristinabile): vedi [noteId]/route.ts.
 * Permesso: chi registra interventi a diario o modifica il fascicolo.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const allowed =
    (await userCan(user.role, "machine.intervention")) || (await userCan(user.role, "machine.edit"));
  if (!allowed) return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = await req.json().catch(() => null);
  const text = typeof b?.text === "string" ? b.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Scrivi il testo della nota" }, { status: 400 });
  if (text.length > MAX_LEN)
    return NextResponse.json({ error: `Nota troppo lunga (max ${MAX_LEN} caratteri)` }, { status: 400 });

  const note = await prisma.machineNote.create({
    data: { machineId: id, text, authorId: user.id, authorName: user.name },
  });
  return NextResponse.json({ ok: true, id: note.id });
}
