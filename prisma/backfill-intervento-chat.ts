import { prisma } from "../src/lib/db";

/**
 * Crea la chat dedicata per gli interventi esistenti che non ne hanno una.
 *   npx tsx prisma/backfill-intervento-chat.ts
 */
async function main() {
  const interventi = await prisma.intervento.findMany({
    where: { deletedAt: null, conversations: { none: {} } },
    select: { id: true, code: true, title: true, customerId: true, machineId: true },
  });
  console.log(`Interventi senza chat: ${interventi.length}`);
  let created = 0;
  for (const i of interventi) {
    await prisma.conversation.create({
      data: {
        title: `Intervento ${i.code} — ${i.title}`,
        channel: "native",
        interventoId: i.id,
        customerId: i.customerId,
        machineId: i.machineId,
      },
    });
    created++;
  }
  console.log(`Chat create: ${created}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
