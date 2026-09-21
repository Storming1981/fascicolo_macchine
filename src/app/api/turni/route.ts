import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import {
  findConflicts,
  freeSlices,
  reconcileIntervento,
  dayStart,
  dayEnd,
  isoDay,
} from "@/lib/turni";

export const dynamic = "force-dynamic";

/**
 * Turni di presenza: creazione e spostamento dal planner.
 *
 * Il controllo dei conflitti sta **qui**, non solo nella pagina: il planner è
 * un'interfaccia a trascinamento e non è l'unico modo per arrivare a scrivere
 * un turno. Se c'è sovrapposizione si risponde **409 con i dettagli** e i
 * tratti liberi, così il client può proporre azioni sensate invece di un "no".
 *
 * Per scrivere comunque: `force: true` (sovrapposizione voluta) oppure
 * `fit: true` (si tiene solo ciò che è libero).
 */

type Body = {
  interventoId?: string;
  turnoId?: string;
  userId?: string;
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD
  role?: "lead" | "member";
  force?: boolean;
  fit?: boolean;
};

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  // Turno esistente da spostare/ridimensionare, oppure turno nuovo.
  const existing = b.turnoId
    ? await prisma.interventoTurno.findUnique({ where: { id: b.turnoId } })
    : null;
  if (b.turnoId && !existing)
    return NextResponse.json({ error: "Turno non trovato" }, { status: 404 });

  const interventoId = existing?.interventoId ?? b.interventoId;
  const userId = existing?.userId ?? b.userId;
  if (!interventoId || !userId)
    return NextResponse.json({ error: "Servono intervento e persona" }, { status: 400 });

  const startIso = isDay(b.start) ? b.start : existing ? isoDay(existing.start) : null;
  const endIso = isDay(b.end) ? b.end : existing ? isoDay(existing.end) : startIso;
  if (!startIso || !endIso || endIso < startIso)
    return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });

  const conflicts = await findConflicts(userId, startIso, endIso, existing?.id);

  if (conflicts.length && !b.force && !b.fit) {
    const who = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return NextResponse.json(
      {
        error: "conflitto",
        userName: who?.name ?? "Il tecnico",
        conflicts,
        // Dove si potrebbe mettere senza accavallare: e' l'azione che con un
        // periodo unico per intervento non esisteva.
        free: freeSlices(startIso, endIso, conflicts),
      },
      { status: 409 }
    );
  }

  // "Adatta ai giorni liberi": si tiene il primo tratto libero (gli altri
  // diventano turni a parte, cosi' la presenza spezzata resta una sola riga
  // per tratto invece di un intervento nuovo).
  const slices =
    b.fit && conflicts.length
      ? freeSlices(startIso, endIso, conflicts)
      : [{ start: startIso, end: endIso }];

  if (!slices.length)
    return NextResponse.json(
      { error: "In quei giorni la persona è occupata tutto il tempo." },
      { status: 409 }
    );

  const role = b.role === "lead" || b.role === "member" ? b.role : existing?.role ?? "member";
  const [first, ...rest] = slices;

  if (existing) {
    await prisma.interventoTurno.update({
      where: { id: existing.id },
      data: {
        start: dayStart(first.start),
        end: dayEnd(first.end),
        role,
        ...(b.force ? { overlapOk: true } : {}),
      },
    });
  } else {
    await prisma.interventoTurno.create({
      data: {
        interventoId,
        userId,
        role,
        start: dayStart(first.start),
        end: dayEnd(first.end),
        overlapOk: !!b.force,
        createdById: user.id,
        createdByName: user.name,
      },
    });
  }

  for (const s of rest) {
    await prisma.interventoTurno.create({
      data: {
        interventoId,
        userId,
        role,
        start: dayStart(s.start),
        end: dayEnd(s.end),
        createdById: user.id,
        createdByName: user.name,
      },
    });
  }

  await reconcileIntervento(interventoId);
  return NextResponse.json({ ok: true, slices });
}

/** Toglie una presenza (non l'intervento). */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("turnoId");
  if (!id) return NextResponse.json({ error: "turnoId mancante" }, { status: 400 });

  const t = await prisma.interventoTurno.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "Turno non trovato" }, { status: 404 });

  await prisma.interventoTurno.delete({ where: { id } });
  await reconcileIntervento(t.interventoId);
  return NextResponse.json({ ok: true });
}
