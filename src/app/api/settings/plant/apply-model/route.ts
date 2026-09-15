import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlantConfig, userCan } from "@/lib/settings";
import { statusToPhase } from "@/lib/domain";

/**
 * POST { plantType, from, to } → porta al modello `to` tutti i fascicoli di
 * quella tipologia con modello `from`.
 * Serve quando in Impostazioni un modello viene rinominato o sostituito
 * (es. BLUE DEVIL: CORPO TRITURATORE → GF4000): la configurazione alimenta
 * solo le tendine, i fascicoli esistenti restano col vecchio valore.
 * Ogni fascicolo riceve a diario "Anagrafica fascicolo aggiornata", come una
 * modifica fatta a mano dalla scheda. Permesso `settings.manage`.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "settings.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const plantType = typeof b?.plantType === "string" ? b.plantType.trim() : "";
  const from = typeof b?.from === "string" ? b.from : "";
  const to = typeof b?.to === "string" ? b.to.trim() : "";
  if (!plantType || !from || !to)
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  if (from === to) return NextResponse.json({ ok: true, updated: 0 });

  // Il modello di destinazione deve esistere nella configurazione salvata:
  // evita di spargere nei fascicoli un valore scritto male.
  const cfg = (await getPlantConfig()).find((p) => p.name === plantType);
  if (!cfg?.models.includes(to))
    return NextResponse.json(
      { error: `"${to}" non è un modello configurato per ${plantType}: salva prima le tipologie` },
      { status: 400 }
    );

  const machines = await prisma.machine.findMany({
    where: { plantType, model: from },
    select: { id: true, status: true },
  });
  if (!machines.length) return NextResponse.json({ ok: true, updated: 0 });

  const now = new Date();
  await prisma.$transaction([
    prisma.machine.updateMany({
      where: { id: { in: machines.map((m) => m.id) } },
      data: { model: to },
    }),
    prisma.diaryEvent.createMany({
      data: machines.map((m) => ({
        machineId: m.id,
        phase: statusToPhase(m.status),
        type: "note",
        title: "Anagrafica fascicolo aggiornata",
        note: `Modello: ${from} → ${to}`,
        date: now,
        actorName: user.name,
        authorId: user.id,
      })),
    }),
  ]);
  return NextResponse.json({ ok: true, updated: machines.length });
}
