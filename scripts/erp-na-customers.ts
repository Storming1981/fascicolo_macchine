/**
 * Copia locale dei clienti ZATO North America (`ZATONA.dbo.anagra`).
 *
 * In produzione li manda il sync-agent; in sviluppo, dove il gestionale si
 * raggiunge direttamente, si popola la tabella con questo script:
 *
 *   npm run erp:na-customers
 */
import { config } from "dotenv";
config();

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { getNaCustomers } = await import("../src/lib/erp");

  const rows = await getNaCustomers();
  console.log(`Clienti ZATO NA letti dal gestionale: ${rows.length}`);
  for (const c of rows) await prisma.erpNaCustomer.upsert({ where: { code: c.code }, update: c, create: c });
  const removed = rows.length
    ? await prisma.erpNaCustomer.deleteMany({ where: { code: { notIn: rows.map((r) => r.code) } } })
    : { count: 0 };
  console.log(`Salvati: ${rows.length} · rimossi: ${removed.count} · totale: ${await prisma.erpNaCustomer.count()}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
