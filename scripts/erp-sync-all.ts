/**
 * Sincronizzazione batch di TUTTI i fascicoli dal gestionale ZATO (ERP).
 * Da usare in sviluppo: `npm run erp:sync`.
 *
 * In produzione lo stesso lavoro è esposto dall'endpoint admin
 * POST /api/erp/sync-all (bottone in Impostazioni) e potrà essere schedulato.
 */

import "dotenv/config";
import { syncAllMachines } from "../src/lib/erpSync";
import { prisma } from "../src/lib/db";

async function main() {
  console.log("📡 Sincronizzazione fascicoli dal gestionale ZATO…\n");

  const summary = await syncAllMachines(undefined, (done, total, last) => {
    if (last.found && last.changed.length > 0) {
      const dates =
        last.erp.productionStart || last.erp.productionEnd
          ? `  prod ${fmt(last.erp.productionStart)} → ${fmt(last.erp.productionEnd)}`
          : "";
      console.log(
        `  [${String(done).padStart(3)}/${total}] ${last.code.padEnd(12)} ` +
          `${last.changed.join(", ")}${dates}`,
      );
    } else if (done % 25 === 0) {
      console.log(`  … ${done}/${total}`);
    }
  });

  console.log("\n──────────────────────────────────────────────");
  console.log(`Totale fascicoli:        ${summary.total}`);
  console.log(`Trovati in gestionale:   ${summary.matched}`);
  console.log(`Aggiornati:              ${summary.updated}`);
  console.log(`Con dati di produzione:  ${summary.withProduction}`);
  if (summary.errors.length > 0) {
    console.log(`\n⚠ Errori (${summary.errors.length}):`);
    for (const e of summary.errors) console.log(`   ${e.code}: ${e.error}`);
  }
  console.log("\n✅ Fatto.\n");

  await prisma.$disconnect();
  process.exit(0);
}

function fmt(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : "—";
}

main().catch(async (e) => {
  console.error("❌", e);
  await prisma.$disconnect();
  process.exit(1);
});
