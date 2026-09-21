import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAcks } from "@/lib/interventoAck";
import { loadInterventoBrief, buildAckNotices } from "@/lib/interventoNotify";
import { createNotifications } from "@/lib/notifications";
import { deliverNotifications } from "@/lib/notifyDeliver";
import { absoluteUrl } from "@/lib/absoluteUrl";

export const dynamic = "force-dynamic";

/**
 * Presa in carico di un intervento da parte di chi ci è stato messo.
 *
 * GET  → quadro della squadra (chi ha accettato, chi no, chi tace) + la
 *        posizione di chi sta guardando.
 * POST → `{accept:true}` oppure `{accept:false, note}`: la risposta torna
 *        subito a chi aveva fatto l'assegnazione, col quadro aggiornato.
 *
 * Nessun permesso di ruolo: **si risponde solo per sé**. Il filtro è la riga
 * `InterventoAck` intestata all'utente loggato; chi non è assegnato non ha
 * niente da accettare.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const mine = await prisma.interventoAck.findUnique({
    where: { interventoId_userId: { interventoId: id, userId: user.id } },
    select: { role: true, acceptedAt: true, declinedAt: true },
  });

  return NextResponse.json({
    team: await listAcks(id),
    me: mine
      ? {
          role: mine.role,
          state: mine.acceptedAt ? "accettato" : mine.declinedAt ? "rifiutato" : "in attesa",
        }
      : null,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const accept = b?.accept !== false; // default: accetta
  const note = typeof b?.note === "string" ? b.note.trim() || null : null;

  const row = await prisma.interventoAck.findUnique({
    where: { interventoId_userId: { interventoId: id, userId: user.id } },
  });
  if (!row)
    return NextResponse.json(
      { error: "Non risulti assegnato a questo intervento." },
      { status: 404 }
    );

  const now = new Date();
  await prisma.interventoAck.update({
    where: { id: row.id },
    data: {
      acceptedAt: accept ? now : null,
      declinedAt: accept ? null : now,
      note: accept ? null : note,
    },
  });

  // ── La risposta torna a chi ha assegnato ──────────────────────────
  // È il punto del giro: il responsabile pianifica e qui scopre, senza aprire
  // l'intervento, chi ci sarà davvero e chi no.
  try {
    const brief = await loadInterventoBrief(id);
    if (brief) {
      const notices = await buildAckNotices(
        brief,
        { id: user.id, name: user.name },
        row.assignedById,
        accept,
        note
      );
      if (notices.length) {
        const ids = await createNotifications(notices.map((n) => n.notification));
        const base = absoluteUrl(req, "");
        after(async () => {
          await deliverNotifications(ids, notices, user.id, base);
        });
      }
    }
  } catch (e) {
    // La risposta è già registrata: l'avviso al responsabile non la annulla.
    console.error("[notifiche] presa in carico", id, e);
  }

  return NextResponse.json({ ok: true, state: accept ? "accettato" : "rifiutato", team: await listAcks(id) });
}
