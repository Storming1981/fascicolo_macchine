import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * Allinea al fascicolo le chat degli interventi e le loro foto.
 *
 * Una chat nasce con la macchina dell'intervento, ma se il fascicolo viene
 * collegato DOPO (INT-2499, 2500, 2503-2505) la chat e le foto restano legate
 * al solo intervento: nella scheda Foto della macchina non si vedevano.
 * Da ora il collegamento si propaga da solo; questo script sistema lo storico.
 *
 * Idempotente: tocca solo le righe senza macchina il cui intervento ce l'ha.
 * `--dry` per vedere cosa cambierebbe senza scrivere.
 */
async function main() {
  const dry = process.argv.includes("--dry");

  const conversations = await prisma.conversation.findMany({
    where: { machineId: null, interventoId: { not: null }, intervento: { machineId: { not: null } } },
    select: {
      id: true,
      title: true,
      intervento: { select: { code: true, machineId: true, customerId: true, machine: { select: { code: true } } } },
    },
  });

  console.log(`Chat da collegare: ${conversations.length}`);
  for (const c of conversations) {
    const m = c.intervento!;
    console.log(`  ${m.code} → ${m.machine?.code ?? "?"}  ${c.title}`);
    if (!dry)
      await prisma.conversation.update({
        where: { id: c.id },
        data: { machineId: m.machineId, customerId: m.customerId ?? undefined },
      });
  }

  // Foto di chat e rapportini legate al solo intervento
  const photos = await prisma.photo.findMany({
    where: { machineId: null, interventoId: { not: null }, intervento: { machineId: { not: null } } },
    select: { id: true, category: true, intervento: { select: { code: true, machineId: true } } },
  });

  const perIntervento = new Map<string, number>();
  for (const p of photos) perIntervento.set(p.intervento!.code, (perIntervento.get(p.intervento!.code) ?? 0) + 1);
  console.log(`\nFoto da collegare: ${photos.length}`);
  for (const [code, n] of perIntervento) console.log(`  ${code}: ${n}`);

  if (!dry) {
    for (const p of photos)
      await prisma.photo.update({ where: { id: p.id }, data: { machineId: p.intervento!.machineId } });
  }

  console.log(dry ? "\n(prova a vuoto: niente scritto)" : "\nFatto.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
