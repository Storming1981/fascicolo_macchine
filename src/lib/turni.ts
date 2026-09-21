import { prisma } from "./db";

/**
 * Turni: la presenza di una persona su un intervento, per un periodo.
 *
 * Regola che tiene in piedi tutto il resto: **i turni sono la verità del
 * planner**, mentre `Intervento.scheduledStart/End`, `assignedTechId` e
 * `participants` sono *derivati* e vengono riallineati a ogni modifica
 * (`reconcileIntervento`). Così rapportini, ore, notifiche, brief e app Campo
 * continuano a leggere i campi di sempre senza sapere che i turni esistono.
 */

/** Giorno in formato YYYY-MM-DD, in ora locale (come il resto del planner). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Inizio giornata (09:00) e fine giornata (18:00), come già fa la pianificazione. */
export function dayStart(iso: string): Date {
  return new Date(`${iso}T09:00:00`);
}
export function dayEnd(iso: string): Date {
  const d = new Date(`${iso}T18:00:00`);
  return d;
}

/** Giorni di distanza fra due date (solo parte giorno). */
export function daysBetween(a: Date, b: Date): number {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((B - A) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export type Conflict = {
  turnoId: string;
  interventoId: string;
  code: string;
  title: string;
  customer: string | null;
  start: string; // iso day
  end: string; // iso day
};

/**
 * Turni della stessa persona che si sovrappongono al periodo indicato.
 * Esclude quello che si sta spostando e quelli marcati come sovrapposizione
 * voluta: segnalare ogni volta una cosa già accettata la rende rumore.
 */
export async function findConflicts(
  userId: string,
  startIso: string,
  endIso: string,
  excludeTurnoId?: string
): Promise<Conflict[]> {
  const rows = await prisma.interventoTurno.findMany({
    where: {
      userId,
      overlapOk: false,
      ...(excludeTurnoId ? { id: { not: excludeTurnoId } } : {}),
      // sovrapposizione: inizia prima che l'altro finisca e finisce dopo che inizia
      start: { lte: dayEnd(endIso) },
      end: { gte: dayStart(startIso) },
      intervento: { deletedAt: null },
    },
    include: {
      intervento: { select: { id: true, code: true, title: true, customer: { select: { name: true } } } },
    },
    orderBy: { start: "asc" },
  });
  return rows.map((r) => ({
    turnoId: r.id,
    interventoId: r.interventoId,
    code: r.intervento.code,
    title: r.intervento.title,
    customer: r.intervento.customer?.name ?? null,
    start: isoDay(r.start),
    end: isoDay(r.end),
  }));
}

/**
 * Spezza un periodo nei tratti in cui la persona è davvero libera.
 * È l'azione "adatta ai giorni liberi" del dialogo di conflitto: con un solo
 * periodo per intervento non si poteva fare, e l'unica uscita era spostare
 * tutto o accavallare.
 */
export function freeSlices(
  startIso: string,
  endIso: string,
  conflicts: Conflict[]
): { start: string; end: string }[] {
  const busy = new Set<string>();
  for (const c of conflicts) {
    let d = c.start;
    while (d <= c.end) {
      busy.add(d);
      d = addDays(d, 1);
    }
  }
  const out: { start: string; end: string }[] = [];
  let cur: { start: string; end: string } | null = null;
  let d = startIso;
  while (d <= endIso) {
    if (busy.has(d)) {
      if (cur) out.push(cur), (cur = null);
    } else {
      if (cur) cur.end = d;
      else cur = { start: d, end: d };
    }
    d = addDays(d, 1);
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Riallinea l'intervento ai suoi turni: capo cantiere, squadra e finestra
 * complessiva. Senza questo passaggio il resto dell'app (che legge ancora
 * quei campi) vedrebbe dati fermi al momento della creazione.
 */
export async function reconcileIntervento(interventoId: string): Promise<void> {
  const turni = await prisma.interventoTurno.findMany({
    where: { interventoId },
    orderBy: { start: "asc" },
  });

  if (!turni.length) {
    await prisma.intervento.update({
      where: { id: interventoId },
      data: { tech: { disconnect: true }, participants: { set: [] } },
    });
    return;
  }

  const lead = turni.find((t) => t.role === "lead");
  const members = [...new Set(turni.filter((t) => t.role !== "lead").map((t) => t.userId))].filter(
    (id) => id !== lead?.userId
  );
  const start = turni.reduce((m, t) => (t.start < m ? t.start : m), turni[0].start);
  const end = turni.reduce((m, t) => (t.end > m ? t.end : m), turni[0].end);

  await prisma.intervento.update({
    where: { id: interventoId },
    data: {
      tech: lead ? { connect: { id: lead.userId } } : { disconnect: true },
      participants: { set: members.map((id) => ({ id })) },
      scheduledStart: start,
      scheduledEnd: end,
    },
  });
}

/**
 * Allinea i turni alla squadra impostata dalla scheda intervento (dove si
 * sceglie *chi*, non *quando*): chi entra prende un turno su tutta la finestra
 * dell'intervento, chi esce li perde tutti. Chi c'è già **non viene toccato**,
 * altrimenti una modifica alla squadra cancellerebbe i turni spezzati
 * costruiti nel planner.
 */
export async function syncTurniFromAssignment(
  interventoId: string,
  leadId: string | null,
  participantIds: string[],
  window: { start: Date | null; end: Date | null },
  actor: { id: string; name: string },
  datesChanged = false
): Promise<void> {
  const desired = new Map<string, "lead" | "member">();
  if (leadId) desired.set(leadId, "lead");
  for (const id of participantIds) if (!desired.has(id)) desired.set(id, "member");

  const existing = await prisma.interventoTurno.findMany({ where: { interventoId } });

  // Fuori chi non fa più parte della squadra (tutti i suoi turni).
  const goneIds = existing.filter((t) => !desired.has(t.userId)).map((t) => t.id);
  if (goneIds.length) await prisma.interventoTurno.deleteMany({ where: { id: { in: goneIds } } });

  const startIso = isoDay(window.start ?? new Date());
  const endIso = window.end ? isoDay(window.end) : startIso;

  for (const [userId, role] of desired) {
    const mine = existing.filter((t) => t.userId === userId);
    if (!mine.length) {
      await prisma.interventoTurno.create({
        data: {
          interventoId,
          userId,
          role,
          start: dayStart(startIso),
          end: dayEnd(endIso),
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
      continue;
    }
    // Ruolo cambiato (promosso a capo cantiere): si aggiorna, le date restano.
    const wrongRole = mine.filter((t) => t.role !== role).map((t) => t.id);
    if (wrongRole.length)
      await prisma.interventoTurno.updateMany({ where: { id: { in: wrongRole } }, data: { role } });

    // Date cambiate dalla scheda intervento: le seguono solo i turni "interi",
    // cioè di chi ha un'unica presenza continua. Chi ne ha più d'uno è stato
    // spezzato apposta nel planner (va via e torna) e riallinearlo alla
    // finestra cancellerebbe proprio il lavoro di pianificazione.
    if (datesChanged && mine.length === 1) {
      await prisma.interventoTurno.update({
        where: { id: mine[0].id },
        data: { start: dayStart(startIso), end: dayEnd(endIso) },
      });
    }
  }
}

export type TurnoView = {
  id: string;
  interventoId: string;
  userId: string;
  userName: string;
  role: "lead" | "member";
  start: string;
  end: string;
  overlapOk: boolean;
};

export async function listTurni(interventoId: string): Promise<TurnoView[]> {
  const rows = await prisma.interventoTurno.findMany({
    where: { interventoId },
    include: { user: { select: { name: true } } },
    orderBy: [{ start: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    interventoId: r.interventoId,
    userId: r.userId,
    userName: r.user.name,
    role: r.role as "lead" | "member",
    start: isoDay(r.start),
    end: isoDay(r.end),
    overlapOk: r.overlapOk,
  }));
}
