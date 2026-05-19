/**
 * Ricalcola paese/codice paese dei fascicoli usando l'anagrafica paesi
 * estesa, così le bandiere non restano grigie (codice XX).
 */
import { PrismaClient } from "@prisma/client";
import { resolveCountry } from "../src/lib/domain";

const prisma = new PrismaClient();

async function main() {
  const machines = await prisma.machine.findMany({
    select: { id: true, country: true, countryCode: true },
  });
  let fixed = 0;
  const stillUnknown = new Set<string>();
  for (const m of machines) {
    const r = resolveCountry(m.country);
    if (r.code !== m.countryCode || r.label !== m.country) {
      await prisma.machine.update({
        where: { id: m.id },
        data: { country: r.label, countryCode: r.code },
      });
      fixed++;
    }
    if (r.code === "XX") stillUnknown.add(m.country);
  }
  console.log(`Aggiornati ${fixed} fascicoli.`);
  if (stillUnknown.size)
    console.log("Paesi ancora non riconosciuti:", [...stillUnknown].join(", "));
  else console.log("Tutti i paesi riconosciuti.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
