import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Feedback su una risposta del Brain (utile / non utile + nota).
 *
 * Non serve a "riaddestrare" il modello: serve a far emergere le domande a cui
 * la knowledge base non sa rispondere, che sono esattamente i documenti da
 * caricare o le procedure da scrivere. È la lista dei buchi da colmare.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const rating = Number(b?.rating);
  if (![1, -1, 0].includes(rating))
    return NextResponse.json({ error: "Valutazione non valida" }, { status: 400 });

  const msg = await prisma.brainMessage.findFirst({
    where: { id, role: "assistant", thread: { userId: user.id } },
    select: { id: true },
  });
  if (!msg) return NextResponse.json({ error: "Messaggio non trovato" }, { status: 404 });

  await prisma.brainMessage.update({
    where: { id },
    data: {
      rating: rating === 0 ? null : rating,
      ratingNote: typeof b?.note === "string" ? b.note.slice(0, 500) : null,
    },
  });
  return NextResponse.json({ ok: true });
}
