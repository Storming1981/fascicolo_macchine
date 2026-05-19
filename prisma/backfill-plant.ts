/**
 * Deduce la tipologia impianto per i fascicoli importati che ne sono privi.
 * I dati del file MATRICOLE sono trituratori con corpo + container → BLUE DEVIL.
 * Euristica: presenza di componenti tipici del trituratore (riduttori, motori
 * idraulici, container, lame) ⇒ BLUE DEVIL. In assenza di segnali ⇒ BLUE DEVIL
 * (default richiesto dal committente: "la maggior parte dovrebbero essere BLUE DEVIL").
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEVIL_GROUPS = ["gearboxes", "hyd_motors", "hyd_pumps", "container", "blades"];

async function main() {
  const machines = await prisma.machine.findMany({
    where: { plantType: null },
    include: { components: { include: { items: true } } },
  });
  console.log(`Fascicoli senza tipologia: ${machines.length}`);

  let devil = 0;
  let model = 0;
  for (const m of machines) {
    const hasDevilSignals = m.components.some(
      (c) => DEVIL_GROUPS.includes(c.groupId) && c.items.some((i) => i.serial)
    );
    // default BLUE DEVIL (con o senza segnali, per richiesta committente)
    const plantType = "BLUE DEVIL";
    void hasDevilSignals;

    const data: { plantType: string; model?: string } = { plantType };
    if (m.model === "Da definire") {
      data.model = "CORPO TRITURATORE";
      model++;
    }
    await prisma.machine.update({ where: { id: m.id }, data });
    devil++;
  }

  console.log(
    `Aggiornati ${devil} fascicoli a BLUE DEVIL (${model} con modello → CORPO TRITURATORE).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
