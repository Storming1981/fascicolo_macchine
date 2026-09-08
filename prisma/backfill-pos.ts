/**
 * Backfill P.O.S. — Piano Operativo di Sicurezza.
 *
 * 1) Gli interventi già in essere sono nati prima dell'introduzione del vincolo:
 *    vengono "graziati" (posValidated = true, con nota storica) così restano
 *    pianificabili e non si bloccano lavori in corso. Il vincolo vale per i
 *    nuovi interventi.
 * 2) Abilita come validatore P.O.S. il responsabile indicato (default: Fausto
 *    Zanotti; si può passare un altro nome/email come argomento).
 *
 *   npx tsx prisma/backfill-pos.ts ["Nome Cognome" | email]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STORICO = "Storico (pre-P.O.S.)";

async function main() {
  const target = process.argv[2] ?? "Fausto Zanotti";

  // 1) grazia agli interventi esistenti
  const grandfathered = await prisma.intervento.updateMany({
    where: { posValidated: false },
    data: {
      posValidated: true,
      posValidatedAt: new Date(),
      posValidatedByName: STORICO,
      posNote: "Intervento precedente all'introduzione dell'obbligo di P.O.S.",
    },
  });
  console.log(`Interventi storici sbloccati: ${grandfathered.count}`);

  // 2) responsabile validatore
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: target.toLowerCase() },
        { name: { equals: target, mode: "insensitive" } },
        { name: { contains: target, mode: "insensitive" } },
      ],
    },
  });
  if (!user) {
    console.log(
      `Utente "${target}" non trovato: crealo da Persone e spunta "Validatore P.O.S." nella sua anagrafica.`
    );
  } else if (user.posValidator) {
    console.log(`${user.name} è già validatore P.O.S.`);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { posValidator: true } });
    console.log(`${user.name} (${user.email}) abilitato come validatore P.O.S.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
