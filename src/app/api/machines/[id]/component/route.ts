import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Componenti CUSTOM (non a catalogo): crea un nuovo gruppo componente su una
 * macchina con i suoi "campi da compilare" (ogni campo = uno slot con matricola/
 * valore). groupId = "custom-<uuid>". Elimina un gruppo custom.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")) && !(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = await req.json().catch(() => null);
  const label = typeof b?.label === "string" ? b.label.trim() : "";
  if (!label) return NextResponse.json({ error: "Nome componente obbligatorio" }, { status: 400 });
  const brand = typeof b?.brand === "string" ? b.brand.trim() || null : null;
  const fields: string[] = Array.isArray(b?.fields)
    ? b.fields.map((f: unknown) => String(f ?? "").trim()).filter(Boolean)
    : [];
  const slots = fields.length ? fields : ["Matricola"];

  const component = await prisma.component.create({
    data: {
      machineId: id,
      groupId: `custom-${randomUUID()}`,
      label,
      brand,
      items: {
        create: slots.map((lbl, i) => ({ position: i + 1, label: lbl })),
      },
    },
  });

  await prisma.diaryEvent.create({
    data: {
      machineId: id,
      phase: "PRODUCTION",
      type: "component-add",
      title: `Nuovo componente: ${label}`,
      note: slots.join(", "),
      actorName: user.name,
      authorId: user.id,
    },
  });

  return NextResponse.json({ ok: true, componentId: component.id });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")) && !(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const componentId = new URL(req.url).searchParams.get("componentId");
  if (!componentId) return NextResponse.json({ error: "componentId mancante" }, { status: 400 });

  const comp = await prisma.component.findUnique({ where: { id: componentId } });
  if (!comp || comp.machineId !== id)
    return NextResponse.json({ error: "Componente non trovato" }, { status: 404 });
  if (!comp.groupId.startsWith("custom-"))
    return NextResponse.json({ error: "Solo i componenti personalizzati possono essere eliminati" }, { status: 400 });

  await prisma.component.delete({ where: { id: componentId } });
  return NextResponse.json({ ok: true });
}
