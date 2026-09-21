/**
 * Prova del giro completo delle notifiche di un intervento, a secco sul DB.
 *
 *   npm run notif:flusso
 *
 * Percorre i quattro passaggi concordati — creazione → P.O.S. validato →
 * pianificazione → prese in carico — e stampa a ogni passo CHI riceve cosa.
 * Serve a vedere che nessun anello resti scoperto: un avviso che non parte non
 * si nota finche' qualcuno non resta ad aspettare.
 *
 * Non tocca la posta: costruisce le notifiche senza consegnarle, e alla fine
 * cancella tutto quello che ha creato.
 */
import { prisma } from "../src/lib/db";
import {
  loadInterventoBrief,
  buildPosToUploadNotices,
  buildPosToValidateNotices,
  buildPosValidatedNotices,
  buildAssignmentNotices,
  buildAckNotices,
  type Notice,
} from "../src/lib/interventoNotify";
import { syncAcks, listAcks } from "../src/lib/interventoAck";

const show = (passo: string, notices: Notice[]) => {
  console.log(`\n── ${passo} ${"─".repeat(Math.max(0, 58 - passo.length))}`);
  if (!notices.length) return console.log("   (nessuna notifica)");
  for (const n of notices)
    console.log(
      `   → ${n.notification.userId.slice(-6)} ${n.notification.title}\n     ${n.notification.body
        .split("\n")[0]
        .slice(0, 120)}`
    );
};

async function main() {
  // Cinque persone DIVERSE: con attori coincidenti scatterebbe la regola del
  // "non ci si autonotifica" e certi passaggi sembrerebbero non funzionare.
  const admins = await prisma.user.findMany({ where: { active: true, role: "ADMIN" }, orderBy: { name: "asc" } });
  const tecnici = await prisma.user.findMany({
    where: { active: true, role: "TECNICO_CAMPO" },
    orderBy: { name: "asc" },
  });
  if (admins.length < 2 || tecnici.length < 2) {
    console.log("Servono almeno 2 admin e 2 tecnici attivi per provare il giro.");
    return;
  }
  const [creatore, validatore] = admins;
  const responsabile = admins[1];
  const [capo, operaio] = tecnici;
  const nomi = (u: { id: string; name: string }) => `${u.name} (${u.id.slice(-6)})`;
  console.log("Attori:");
  console.log("  crea       :", nomi(creatore));
  console.log("  valida POS :", nomi(validatore));
  console.log("  pianifica  :", nomi(responsabile));
  console.log("  capo cant. :", nomi(capo));
  console.log("  operaio    :", nomi(operaio));

  const cust = await prisma.customer.findFirst({ include: { sites: { take: 1 } } });
  const i = await prisma.intervento.create({
    data: {
      code: `TEST-${Date.now().toString().slice(-6)}`,
      title: "PROVA flusso notifiche",
      description: "Intervento di prova, cancellato a fine test.",
      type: "MANUTENZIONE",
      priority: 2,
      customerId: cust?.id ?? null,
      siteId: cust?.sites[0]?.id ?? null,
      createdById: creatore.id,
      createdByName: creatore.name,
    },
  });
  const brief0 = (await loadInterventoBrief(i.id))!;

  // 1. creazione → chi valida il P.O.S.
  show("1. Creazione intervento", await buildPosToUploadNotices(brief0, creatore));

  // 2. file caricato → chi valida il P.O.S.
  show("2. P.O.S. caricato", await buildPosToValidateNotices(brief0, creatore, "POS.pdf"));

  // 3. P.O.S. validato → torna al creatore
  show(
    "3. P.O.S. validato",
    await buildPosValidatedNotices(brief0, i.createdById, validatore)
  );
  await prisma.intervento.update({
    where: { id: i.id },
    data: { posValidated: true, status: "NUOVO" },
  });

  // 4. pianificazione: capo cantiere + squadra + date
  await prisma.intervento.update({
    where: { id: i.id },
    data: {
      assignedTechId: capo.id,
      participants: { set: [{ id: operaio.id }] },
      scheduledStart: new Date("2026-11-03"),
      scheduledEnd: new Date("2026-11-07"),
      status: "PIANIFICATO",
    },
  });
  const brief1 = (await loadInterventoBrief(i.id))!;
  show(
    "4. Pianificazione (capo + squadra + date)",
    await buildAssignmentNotices(
      brief1,
      { leadId: null, participantIds: [], scheduledStart: null, scheduledEnd: null },
      responsabile
    )
  );
  const daAccettare = await syncAcks(i.id, capo.id, [operaio.id], responsabile, false);
  console.log("   devono rispondere:", daAccettare.length, "persone");

  // 5. il capo cantiere accetta → torna al responsabile
  await prisma.interventoAck.update({
    where: { interventoId_userId: { interventoId: i.id, userId: capo.id } },
    data: { acceptedAt: new Date() },
  });
  show(
    "5. Il capo cantiere accetta",
    await buildAckNotices(brief1, capo, responsabile.id, true, null)
  );

  // 6. l'operaio rifiuta → torna al responsabile, col quadro aggiornato
  await prisma.interventoAck.update({
    where: { interventoId_userId: { interventoId: i.id, userId: operaio.id } },
    data: { declinedAt: new Date(), note: "Sono gia' su un altro cantiere" },
  });
  show(
    "6. L'operaio non puo' andarci",
    await buildAckNotices(brief1, operaio, responsabile.id, false, "Sono gia' su un altro cantiere")
  );

  console.log("\n── Quadro finale della squadra ─────────────────────────────");
  for (const a of await listAcks(i.id))
    console.log(`   ${a.name.padEnd(22)} ${a.role.padEnd(7)} ${a.state}${a.note ? " — " + a.note : ""}`);

  // 7. le date si spostano: le risposte gia' date decadono
  const ri = await syncAcks(i.id, capo.id, [operaio.id], responsabile, true);
  console.log("\n7. Date spostate → tornano in attesa:", ri.length, "persone");
  for (const a of await listAcks(i.id)) console.log(`   ${a.name.padEnd(22)} ${a.state}`);

  await prisma.intervento.delete({ where: { id: i.id } });
  console.log("\nIntervento di prova eliminato.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
