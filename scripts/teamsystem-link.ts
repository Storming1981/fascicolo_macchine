// Aggancia gli utenti dell'app ai dipendenti TeamSystem HR (codice fiscale +
// ID_PERSON), la chiave per leggere il loro fascicolo documenti.
//
//   npm run teamsystem:link            aggancia chi non è ancora collegato
//   npm run teamsystem:link -- --relink  rifà anche i collegamenti automatici
//
// Stampa chi è stato agganciato a chi e chi resta fuori: i "non trovati" vanno
// sistemati in Persone (nome o matricola diversi dall'anagrafica TeamSystem).
// Non stampa codici fiscali.
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { linkUsers } from "../src/lib/tecniciDocs";
import { teamsystemConfigured } from "../src/lib/teamsystemHr";

async function main() {
  if (!teamsystemConfigured()) throw new Error("mancano TEAMSYSTEM_HR_* nel .env");
  const relink = process.argv.includes("--relink");
  const users = await prisma.user.findMany({
    where: { active: true, role: { not: "CLIENTE" } },
    select: { id: true },
  });
  const res = await linkUsers(
    users.map((u) => u.id),
    { relink }
  );
  const ok = res.filter((r) => r.person);
  const ko = res.filter((r) => !r.person);
  for (const r of ok) console.log(`  ✓ ${r.name.padEnd(28)} → ${r.person!.surname} ${r.person!.name} (${r.person!.personId})`);
  for (const r of ko) console.log(`  ✗ ${r.name.padEnd(28)} → non trovato`);
  const linked = await prisma.user.count({ where: { active: true, tsPersonId: { not: null } } });
  console.log(`\n${ok.length} agganciati ora, ${ko.length} non trovati, ${linked} utenti collegati in totale.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
