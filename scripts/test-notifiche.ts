/**
 * Prova a secco delle notifiche di cantiere: prende un intervento vero, simula
 * l'assegnazione di un capo cantiere e stampa le notifiche che ne uscirebbero,
 * col brief completo. NON invia mail e NON scrive nel database.
 *
 *   npm run notif:test
 *
 * Serve a vedere il testo che arriva davvero all'utente prima di spedirlo: il
 * brief si costruisce da dati veri (cliente, cantiere, macchina, date) e un
 * campo vuoto si nota solo qui.
 */
import { prisma } from "../src/lib/db";
import { loadInterventoBrief, buildAssignmentNotices } from "../src/lib/interventoNotify";

async function main() {
  const arg = process.argv[2];
  // Senza argomento si prende l'intervento piu' completo: uno con date,
  // commessa e descrizione mostra il brief per davvero, mentre su uno vuoto
  // sembrerebbe tutto a posto anche se mancassero dei campi.
  const intervento = arg
    ? await prisma.intervento.findFirst({ where: { OR: [{ code: arg }, { id: arg }] } })
    : (
        await prisma.intervento.findMany({
          where: { deletedAt: null, customerId: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 60,
        })
      ).sort(
        (a, b) =>
          [b.scheduledStart, b.commessa, b.description, b.siteId, b.machineId].filter(Boolean).length -
          [a.scheduledStart, a.commessa, a.description, a.siteId, a.machineId].filter(Boolean).length
      )[0];

  if (!intervento) {
    console.log("Nessun intervento su cui provare. Passa un codice: npm run notif:test INT-2487");
    return;
  }

  const brief = await loadInterventoBrief(intervento.id);
  if (!brief) return;

  const actor = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (!actor) {
    console.log("Serve un admin attivo per simulare chi assegna.");
    return;
  }

  // Si usa il brief COSI' COM'E' (capo cantiere e squadra veri) e si finge solo
  // che prima non ci fosse nessuno: sostituire il capo cantiere a mano
  // sfaserebbe l'intestazione dai dati, e il testo stampato non sarebbe quello
  // che l'utente riceverebbe davvero.
  const notices = await buildAssignmentNotices(
    brief,
    { leadId: null, participantIds: [], scheduledStart: null, scheduledEnd: null },
    { id: actor.id, name: actor.name }
  );

  console.log(`\nIntervento ${brief.code} — ${brief.title}`);
  console.log(`Capo cantiere: ${brief.leadName ?? "(nessuno)"}`);
  console.log(`Assegnato da: ${actor.name}`);
  console.log("=".repeat(72));

  if (!notices.length) {
    console.log("Nessuna notifica prodotta (nulla e' cambiato per nessuno).");
  }
  for (const n of notices) {
    console.log(`\n### ${n.notification.title}   [${n.notification.kind}, ${n.notification.tone}]`);
    console.log(`mail a: ${n.notification.emailTo ?? "(nessun indirizzo)"}`);
    console.log("-".repeat(72));
    console.log(n.notification.body);
    console.log("-".repeat(72));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
