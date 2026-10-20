import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { BLOCKS, blockKindOf, blockNumberOf } from "@/lib/allestimento";

/**
 * Blocchi ripetibili delle schede di allestimento: i **nastri** di una linea di
 * separazione e i **separatori** montati (piano vibrante, tamburo magnetico,
 * overbelt, ECS).
 *
 * Non sono gruppi componente fissi: ogni linea ne monta un numero diverso e
 * alcuni possono non esserci affatto, quindi **ogni pezzo è un componente a
 * sé** — `belt-1`, `overbelt-2`, … — con i campi in `brand`/`extra` e i suoi
 * slot. Il vincolo unico su (machineId, groupId) è il motivo per cui il numero
 * fa parte dell'id, e il prefisso dice di che pezzo si tratta.
 *
 * POST   { kind }                        → aggiunge un blocco
 * PATCH  { componentId, brand?, extra? } → salva i campi
 * DELETE ?componentId=                   → toglie il blocco (e le sue foto)
 */

async function guard(id: string, verb: string) {
  const user = await currentUser();
  if (!user) return { err: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return { err: NextResponse.json({ error: `Permesso negato per ${verb}` }, { status: 403 }) };
  const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!machine) return { err: NextResponse.json({ error: "Macchina non trovata" }, { status: 404 }) };
  return { user };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id, "aggiungere un componente");
  if (g.err) return g.err;

  const b = (await req.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = typeof b?.kind === "string" ? b.kind : "";
  const block = BLOCKS[kind];
  if (!block) return NextResponse.json({ error: "Tipo di componente non previsto" }, { status: 400 });

  const existing = await prisma.component.findMany({
    where: { machineId: id, groupId: { startsWith: `${kind}-` } },
    select: { groupId: true },
  });
  // il numero riparte dal più alto usato: cancellando il terzo di tre e
  // aggiungendone uno, il nuovo è il quarto — i numeri non si riciclano, così
  // una foto vecchia non finisce sotto l'etichetta di un pezzo diverso
  const next = existing.reduce((max, c) => Math.max(max, blockNumberOf(c.groupId)), 0) + 1;
  const label = `${block.label} ${next}`;

  const comp = await prisma.component.create({
    data: {
      machineId: id,
      groupId: `${kind}-${next}`,
      label,
      items: { create: block.slots.map((s, i) => ({ position: i, label: s.label })) },
    },
  });

  await prisma.diaryEvent.create({
    data: {
      machineId: id,
      phase: "PRODUCTION",
      type: "component-add",
      title: `Componente aggiunto: ${label}`,
      actorName: g.user.name,
      authorId: g.user.id,
    },
  });
  return NextResponse.json({ ok: true, componentId: comp.id, label });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id, "modificare un componente");
  if (g.err) return g.err;

  const b = (await req.json().catch(() => null)) as
    | { componentId?: string; brand?: unknown; extra?: Record<string, unknown> }
    | null;
  const componentId = typeof b?.componentId === "string" ? b.componentId : "";
  if (!componentId) return NextResponse.json({ error: "componentId mancante" }, { status: 400 });

  const comp = await prisma.component.findUnique({ where: { id: componentId } });
  const block = comp ? blockKindOf(comp.groupId) : null;
  if (!comp || comp.machineId !== id || !block)
    return NextResponse.json({ error: "Componente non trovato" }, { status: 404 });

  const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const data: Prisma.ComponentUpdateInput = {};
  if (b && "brand" in b) data.brand = str(b.brand) || null;
  if (b?.extra && typeof b.extra === "object") {
    const cur = (comp.extra && typeof comp.extra === "object" ? comp.extra : {}) as Record<string, string>;
    const next = { ...cur };
    // solo i campi dichiarati dal tipo: la scheda non è un posto dove scrivere
    // chiavi a caso
    for (const f of block.fields) {
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
  const g = await guard(id, "eliminare un componente");
  if (g.err) return g.err;

  const componentId = new URL(req.url).searchParams.get("componentId") ?? "";
  const comp = await prisma.component.findUnique({
    where: { id: componentId },
    include: { items: { select: { serial: true } } },
  });
  if (!comp || comp.machineId !== id || !blockKindOf(comp.groupId))
    return NextResponse.json({ error: "Componente non trovato" }, { status: 404 });

  const serials = comp.items.map((i) => (i.serial ?? "").trim()).filter(Boolean);
  await prisma.$transaction([
    prisma.component.delete({ where: { id: componentId } }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: "PRODUCTION",
        type: "note",
        title: `Componente eliminato: ${comp.label ?? comp.groupId}`,
        // le matricole restano a diario: la riga sparisce, la storia no
        note: serials.length ? `Matricole: ${serials.join(", ")}` : null,
        actorName: g.user.name,
        authorId: g.user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
