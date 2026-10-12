import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { statusToPhase } from "@/lib/domain";
import { hasKit, isKitFlag, kitDef, KIT_KEYS } from "@/lib/kits";

/**
 * Spunte di dotazione della macchina, dalla riga del componente nelle schede di
 * allestimento: `tiranteGiunto` (M5.16, riga Giunti sicurezza) e
 * `filtroMaggiorato` (M5.17, riga Centrale idraulica).
 * POST { <kit>: boolean }. Il cambio viene annotato a diario. Permesso: chi
 * lavora sui componenti (machine.intervention) o modifica il fascicolo (machine.edit).
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
    select: { id: true, plantType: true, status: true, tiranteGiunto: true, filtroMaggiorato: true },
  });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const asked = Object.keys(b ?? {}).filter((k) => KIT_KEYS.includes(k as never));
  if (!b || asked.length !== 1 || typeof b[asked[0]] !== "boolean" || !isKitFlag(asked[0]))
    return NextResponse.json({ error: "Valore non valido" }, { status: 400 });

  const key = asked[0];
  const def = kitDef(key)!;
  const value = b[key] as boolean;
  if (!hasKit(key, machine.plantType))
    return NextResponse.json({ error: `${def.label}: non previsto per questa tipologia impianto` }, { status: 400 });
  if (value === machine[key]) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.$transaction([
    prisma.machine.update({ where: { id }, data: { [key]: value } }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "note",
        title: value ? def.diary[0] : def.diary[1],
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
