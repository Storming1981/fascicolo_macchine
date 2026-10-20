import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { BELT_PREFIX, isBeltGroup } from "@/lib/components";
import { BELT_FIELDS, BELT_SLOTS } from "@/lib/allestimento";

/**
 * Nastri di una linea di separazione.
 *
 * Non sono un gruppo componente solo: ogni linea ne monta un numero diverso,
 * quindi **ogni nastro è un componente a sé** (`belt-1`, `belt-2`, …) con il
 * produttore in `brand`, gli altri campi in `extra` e tre slot — matricola
 * nastro, motoriduttore, scheda di lubrificazione. Il vincolo unico su
 * (machineId, groupId) è il motivo per cui il numero fa parte dell'id.
 *
 * POST   → aggiunge un nastro ("+" nella scheda)
 * PATCH  { componentId, brand?, extra? } → salva i campi del nastro
 * DELETE ?componentId= → toglie il nastro (con tutte le sue foto)
 */

async function guard(id: string, verb: string) {
  const user = await currentUser();
  if (!user) return { err: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return { err: NextResponse.json({ error: `Permesso negato per ${verb} i nastri` }, { status: 403 }) };
  const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!machine) return { err: NextResponse.json({ error: "Macchina non trovata" }, { status: 404 }) };
  return { user, machine };
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id, "aggiungere");
  if (g.err) return g.err;

  const existing = await prisma.component.findMany({
    where: { machineId: id, groupId: { startsWith: BELT_PREFIX } },
    select: { groupId: true },
  });
  // il numero riparte dal più alto usato: cancellando il terzo di tre nastri e
  // aggiungendone uno, il nuovo è il 4 — i numeri non si riciclano, così una
  // foto vecchia non finisce sotto l'etichetta di un nastro diverso
  const next =
    existing.reduce((max, c) => Math.max(max, Number(c.groupId.slice(BELT_PREFIX.length)) || 0), 0) + 1;

  const belt = await prisma.component.create({
    data: {
      machineId: id,
      groupId: `${BELT_PREFIX}${next}`,
      label: `Nastro ${next}`,
      items: { create: BELT_SLOTS.map((s, i) => ({ position: i, label: s.label })) },
    },
  });

  await prisma.diaryEvent.create({
    data: {
      machineId: id,
      phase: "PRODUCTION",
      type: "component-add",
      title: `Nastro aggiunto: Nastro ${next}`,
      actorName: g.user.name,
      authorId: g.user.id,
    },
  });
  return NextResponse.json({ ok: true, componentId: belt.id, label: belt.label });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id, "modificare");
  if (g.err) return g.err;

  const b = (await req.json().catch(() => null)) as
    | { componentId?: string; brand?: unknown; extra?: Record<string, unknown> }
    | null;
  const componentId = typeof b?.componentId === "string" ? b.componentId : "";
  if (!componentId) return NextResponse.json({ error: "componentId mancante" }, { status: 400 });

  const comp = await prisma.component.findUnique({ where: { id: componentId } });
  if (!comp || comp.machineId !== id || !isBeltGroup(comp.groupId))
    return NextResponse.json({ error: "Nastro non trovato" }, { status: 404 });

  const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const data: Prisma.ComponentUpdateInput = {};
  if (b && "brand" in b) data.brand = str(b.brand) || null;
  if (b?.extra && typeof b.extra === "object") {
    const cur = (comp.extra && typeof comp.extra === "object" ? comp.extra : {}) as Record<string, string>;
    const next = { ...cur };
    // solo i campi dichiarati: la scheda non è un posto dove scrivere chiavi a caso
    for (const f of BELT_FIELDS) {
      if (f.key === "brand" || !(f.key in b.extra)) continue;
      const v = str(b.extra[f.key]);
      if (v) next[f.key] = v;
      else delete next[f.key];
    }
    data.extra = next as Prisma.InputJsonValue;
  }
  if (Object.keys(data).length) await prisma.component.update({ where: { id: componentId }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id, "eliminare");
  if (g.err) return g.err;

  const componentId = new URL(req.url).searchParams.get("componentId") ?? "";
  const comp = await prisma.component.findUnique({
    where: { id: componentId },
    include: { items: { select: { serial: true } } },
  });
  if (!comp || comp.machineId !== id || !isBeltGroup(comp.groupId))
    return NextResponse.json({ error: "Nastro non trovato" }, { status: 404 });

  const serials = comp.items.map((i) => (i.serial ?? "").trim()).filter(Boolean);
  await prisma.$transaction([
    prisma.component.delete({ where: { id: componentId } }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: "PRODUCTION",
        type: "note",
        title: `Nastro eliminato: ${comp.label ?? comp.groupId}`,
        // le matricole restano a diario: la riga sparisce, la storia no
        note: serials.length ? `Matricole: ${serials.join(", ")}` : null,
        actorName: g.user.name,
        authorId: g.user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
