/**
 * Migrazione ai turni di presenza.
 *
 *   npm run service:backfill-turni
 *
 * Per ogni intervento pianificato crea UN turno per persona con le date
 * dell'intervento: il planner disegna esattamente quello che disegnava prima,
 * zero cambiamenti visibili. Da li' in poi i turni si possono spezzare.
 *
 * Idempotente: salta gli interventi che hanno gia' dei turni.
 */
import { prisma } from "../src/lib/db";
import { dayStart, dayEnd, isoDay } from "../src/lib/turni";

async function main() {
  const interventi = await prisma.intervento.findMany({
    where: { deletedAt: null, scheduledStart: { not: null } },
    include: { participants: { select: { id: true, name: true } }, tech: { select: { id: true, name: true } } },
    orderBy: { code: "asc" },
  });

  let creati = 0;
  let saltati = 0;
  for (const i of interventi) {
    const gia = await prisma.interventoTurno.count({ where: { interventoId: i.id } });
    if (gia) {
      saltati++;
      continue;
    }
    const people: { id: string; role: "lead" | "member" }[] = [];
    if (i.assignedTechId) people.push({ id: i.assignedTechId, role: "lead" });
    for (const p of i.participants) if (p.id !== i.assignedTechId) people.push({ id: p.id, role: "member" });
    if (!people.length) continue;

    const s = isoDay(i.scheduledStart!);
    const e = isoDay(i.scheduledEnd ?? i.scheduledStart!);
    for (const p of people) {
      await prisma.interventoTurno.create({
        data: {
          interventoId: i.id,
          userId: p.id,
          role: p.role,
          start: dayStart(s),
          end: dayEnd(e),
          createdByName: "migrazione",
        },
      });
      creati++;
    }
    console.log(`${i.code}: ${people.length} turni  ${s} → ${e}`);
  }

  console.log(`\nTurni creati: ${creati} · interventi gia' migrati: ${saltati}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
