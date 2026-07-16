import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Imposta/corregge la MATRICOLA di uno slot componente (flusso rapido da campo:
 * foto → OCR → salva). Registra un evento leggero nel diario (senza firma). Per
 * la sostituzione formale con firma resta il flusso "Sostituisci" (intervento).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b || typeof b.itemId !== "string")
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const item = await prisma.componentItem.findUnique({
    where: { id: b.itemId },
    include: { component: { select: { machineId: true, groupId: true } } },
  });
  if (!item || item.component.machineId !== id)
    return NextResponse.json({ error: "Slot non trovato" }, { status: 404 });

  const newSerial = typeof b.serial === "string" ? b.serial.trim() || null : item.serial;
  const note = typeof b.note === "string" ? b.note.trim() || null : item.note;
  const prev = item.serial;

  await prisma.componentItem.update({ where: { id: item.id }, data: { serial: newSerial, note } });

  // Evento a diario (leggero, senza firma) per tracciare l'assegnazione/correzione.
  if (newSerial && newSerial !== prev) {
    await prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: "PRODUCTION",
        type: prev ? "serial-edit" : "serial",
        title: prev
          ? `Matricola aggiornata: ${item.label} (${prev} → ${newSerial})`
          : `Matricola assegnata: ${item.label} → ${newSerial}`,
        actorName: user.name,
        oldSerial: prev,
        newSerial,
        componentRef: item.label,
        authorId: user.id,
      },
    });
  }

  return NextResponse.json({ ok: true, serial: newSerial });
}

/** Aggiunge un campo/slot a un gruppo componente. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const componentId = typeof b?.componentId === "string" ? b.componentId : "";
  const label = typeof b?.label === "string" ? b.label.trim() : "";
  if (!componentId || !label)
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });

  const comp = await prisma.component.findUnique({
    where: { id: componentId },
    include: { items: { orderBy: { position: "desc" }, take: 1 } },
  });
  if (!comp || comp.machineId !== id)
    return NextResponse.json({ error: "Componente non trovato" }, { status: 404 });

  const nextPos = (comp.items[0]?.position ?? 0) + 1;
  const item = await prisma.componentItem.create({
    data: { componentId, position: nextPos, label },
  });
  return NextResponse.json({ ok: true, itemId: item.id });
}

/** Rimuove un campo/slot (solo dai gruppi custom). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId mancante" }, { status: 400 });

  const item = await prisma.componentItem.findUnique({
    where: { id: itemId },
    include: { component: { select: { machineId: true, groupId: true } } },
  });
  if (!item || item.component.machineId !== id)
    return NextResponse.json({ error: "Slot non trovato" }, { status: 404 });
  if (!item.component.groupId.startsWith("custom-"))
    return NextResponse.json({ error: "Solo i campi dei componenti personalizzati sono eliminabili" }, { status: 400 });

  await prisma.componentItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
