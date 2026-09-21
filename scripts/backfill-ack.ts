/**
 * Recupero: prese in carico rimaste "in attesa" su interventi GIA' PARTITI.
 *
 *   npm run service:backfill-ack
 *
 * L'accettazione e' nata dopo che alcuni cantieri erano gia' in corso: a quelle
 * persone e' comparso un "confermi che ci sarai?" su un lavoro che stavano
 * gia' facendo. Qui si chiudono come accettate — su un cantiere partito la
 * presenza e' un fatto, non una promessa.
 *
 * Idempotente: tocca solo le righe ancora senza risposta.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const pending = await prisma.interventoAck.findMany({
    where: {
      acceptedAt: null,
      declinedAt: null,
      intervento: { status: { in: ["IN_CORSO", "COMPLETATO", "FATTURATO"] } },
    },
    include: {
      user: { select: { name: true } },
      intervento: { select: { code: true, status: true } },
    },
  });

  if (!pending.length) {
    console.log("Nessuna presa in carico da recuperare.");
  }
  for (const a of pending) {
    await prisma.interventoAck.update({
      where: { id: a.id },
      data: { acceptedAt: a.assignedAt },
    });
    console.log(
      `${a.intervento.code} (${a.intervento.status}) — ${a.user.name}: in attesa → accettato`
    );
  }

  // Le notifiche che chiedevano di accettare non hanno piu' motivo di esistere
  // come richiamo: restano leggibili, ma il pulsante sparisce da solo perche'
  // la riga non e' piu' in attesa.
  console.log(`\nRecuperate: ${pending.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
