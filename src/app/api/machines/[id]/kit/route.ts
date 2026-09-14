import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { statusToPhase } from "@/lib/domain";
import { hasTiranteGiunto } from "@/lib/plant";

/**
 * Kit opzionali della macchina, spuntati dalla scheda Componenti & Matricole.
 * POST { tiranteGiunto: boolean } → kit "tirante giunto" (solo BLUE DEVIL).
 * Il cambio viene annotato a diario. Permesso: chi lavora sui componenti
 * (machine.intervention) o chi modifica il fascicolo (machine.edit).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const allowed =
    (await userCan(user.role, "machine.intervention")) || (await userCan(user.role, "machine.edit"));
  if (!allowed) return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, plantType: true, status: true, tiranteGiunto: true },
  });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = await req.json().catch(() => null);
  if (typeof b?.tiranteGiunto !== "boolean")
    return NextResponse.json({ error: "Valore non valido" }, { status: 400 });
  if (!hasTiranteGiunto(machine.plantType))
    return NextResponse.json(
      { error: "Il kit tirante giunto è previsto solo sui BLUE DEVIL" },
      { status: 400 }
    );
  if (b.tiranteGiunto === machine.tiranteGiunto) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.$transaction([
    prisma.machine.update({ where: { id }, data: { tiranteGiunto: b.tiranteGiunto } }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "note",
        title: b.tiranteGiunto ? "Kit tirante giunto: montato" : "Kit tirante giunto: non montato",
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
