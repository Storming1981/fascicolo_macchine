import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { loadInterventoBrief, buildA1AssignedNotices } from "@/lib/interventoNotify";
import { createNotifications } from "@/lib/notifications";
import { deliverNotifications } from "@/lib/notifyDeliver";
import { absoluteUrl } from "@/lib/absoluteUrl";
import type { Role } from "@prisma/client";

const SOLA_LETTURA: Role[] = ["VISUALIZZATORE", "COLLAUDATORE_ESTERNO", "CLIENTE"];

/**
 * Incarico di caricare i **documenti A1** di un intervento.
 *
 * POST   → affida il compito a una persona (e glielo notifica).
 * DELETE → toglie l'incarico; i file già caricati restano dove sono.
 *
 * La cartella A1 esiste comunque su ogni intervento: qui si decide solo **chi**
 * la deve riempire. Non c'è nessun blocco sulla pianificazione — a differenza
 * del P.O.S., che invece è vincolante.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: { id: true, a1AssigneeId: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const assigneeId = typeof b.assigneeId === "string" ? b.assigneeId.trim() : "";
  if (!assigneeId) return NextResponse.json({ error: "Scegli l'incaricato" }, { status: 400 });

  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, name: true, active: true, role: true },
  });
  if (!assignee?.active)
    return NextResponse.json({ error: "Utente non valido o disattivato" }, { status: 400 });

  // Ruoli che `src/proxy.ts` tiene in sola lettura: l'incarico si potrebbe
  // dare, ma il caricamento verrebbe poi rifiutato a monte — meglio dirlo
  // subito che lasciare qualcuno davanti a un pulsante che non funziona.
  if (SOLA_LETTURA.includes(assignee.role))
    return NextResponse.json(
      {
        error: `${assignee.name} ha un accesso in sola lettura e non potrebbe caricare i documenti. Scegli un'altra persona o cambiale il ruolo.`,
      },
      { status: 400 }
    );

  const note = typeof b.note === "string" ? b.note.trim() || null : null;
  // Cambio di incaricato (o prima assegnazione): è l'unico caso in cui ha senso
  // avvisare. Risalvare la stessa persona non deve rimandare la notifica.
  const isNew = intervento.a1AssigneeId !== assigneeId;

  await prisma.intervento.update({
    where: { id },
    data: {
      a1AssigneeId: assigneeId,
      a1AssignedAt: new Date(),
      a1AssignedById: user.id,
      a1AssignedByName: user.name,
      a1Note: note,
    },
  });

  if (isNew) {
    try {
      const brief = await loadInterventoBrief(id);
      if (brief) {
        const notices = await buildA1AssignedNotices(
          brief,
          assigneeId,
          { id: user.id, name: user.name },
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
      // L'incarico è già scritto: un avviso mancato non lo annulla.
      console.error("[notifiche] incarico A1", id, e);
    }
  }

  return NextResponse.json({ ok: true, notified: isNew });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const exists = await prisma.intervento.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  await prisma.intervento.update({
    where: { id },
    data: {
      a1AssigneeId: null,
      a1AssignedAt: null,
      a1AssignedById: null,
      a1AssignedByName: null,
    },
  });
  return NextResponse.json({ ok: true });
}
