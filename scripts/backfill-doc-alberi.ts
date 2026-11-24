import "dotenv/config";
import { prisma } from "../src/lib/db";
import { SHAFT_DOCS } from "../src/lib/allestimento";

/**
 * Archivia nelle caselle della riga *Lotto albero* i documenti dell'albero
 * gia' caricati come allegati generici.
 *
 * Le due caselle (collaudo dimensionale, rilievo alberi) sono nate dopo i
 * file: senza questo, un fascicolo che il documento ce l'ha mostrerebbe la
 * casella vuota e il semaforo rosso nell'elenco macchine — cioe' direbbe il
 * falso.
 *
 * Riconosce i file dal nome, che e' l'unico dato che si ha. Chi non combacia
 * resta dov'e': meglio una casella vuota che un documento archiviato nella
 * casella sbagliata. `--dry` per vedere cosa cambierebbe senza scrivere.
 */
const RULES: { category: string; test: RegExp }[] = [
  { category: "albero_collaudo", test: /collaudo\s+dimensional/i },
  { category: "albero_rilievo", test: /rilievo\s*alber/i },
];

async function main() {
  const dry = process.argv.includes("--dry");

  const docs = await prisma.document.findMany({
    where: { category: "documento" },
    select: { id: true, name: true, machine: { select: { code: true } } },
    orderBy: { uploadedAt: "asc" },
  });

  let n = 0;
  const skipped: string[] = [];
  for (const d of docs) {
    const rule = RULES.find((r) => r.test.test(d.name));
    if (!rule) {
      skipped.push(`${d.machine.code} · ${d.name}`);
      continue;
    }
    const label = SHAFT_DOCS.find((x) => x.category === rule.category)!.label;
    console.log(`${dry ? "[dry] " : ""}${d.machine.code} · ${d.name} → ${label}`);
    if (!dry) await prisma.document.update({ where: { id: d.id }, data: { category: rule.category } });
    n++;
  }

  console.log(`\n${dry ? "da archiviare" : "archiviati"}: ${n} documenti`);
  if (skipped.length) {
    console.log(`restano allegati generici (nome non riconducibile): ${skipped.length}`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERRORE:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
