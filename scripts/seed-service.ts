/**
 * Seed / riconciliazione del modulo Service ancorato all'anagrafica REALE.
 *
 * Costruisce gli interventi demo a partire dalle macchine reali dei fascicoli:
 * - cliente dell'intervento  = cliente reale della macchina (Machine.customerId)
 * - cantiere dell'intervento = un Site del cliente (creato con geo approssimata
 *   dal paese se assente)
 * Rimuove i clienti mock del vecchio prototipo. Idempotente: se gli interventi
 * esistono già li RI-AGGANCIA (reconcile) invece di duplicarli.
 *
 * Uso: `npm run service:seed`.
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";
import type { InterventoStatus } from "@prisma/client";

const ZONE = ["Nord-Ovest", "Nord-Est", "Centro", "Sud", "Isole"];
const MOCK_CODES = ["C-031", "C-018", "C-044", "C-009", "C-051"];

// Coordinate approssimate per paese (per i pin della mappa quando il cantiere
// non ha geo). Un piccolo jitter per indice separa pin dello stesso paese.
const GEO: Record<string, [number, number]> = {
  IT: [44.5, 11.0], SE: [59.33, 18.06], IS: [64.14, -21.94], DE: [51.16, 10.45],
  NO: [59.91, 10.75], FI: [60.17, 24.94], FR: [48.85, 2.35], ES: [40.42, -3.7],
  GB: [51.51, -0.13], NL: [52.37, 4.9], BE: [50.85, 4.35], AT: [48.21, 16.37],
  CH: [46.95, 7.45], PL: [52.23, 21.01], US: [40.71, -74.0], DK: [55.68, 12.57],
};

const TEMPLATES: {
  title: string;
  status: InterventoStatus;
  priority: number;
  channel: string;
  tech: number;
}[] = [
  { title: "Sostituzione martelli trituratore", status: "NUOVO", priority: 1, channel: "whatsapp", tech: 0 },
  { title: "Allarme temperatura cuscinetti", status: "NUOVO", priority: 1, channel: "telegram", tech: 1 },
  { title: "Manutenzione programmata trimestrale", status: "NUOVO", priority: 3, channel: "email", tech: 2 },
  { title: "Sostituzione griglia inferiore", status: "PIANIFICATO", priority: 2, channel: "portale", tech: 3 },
  { title: "Calibrazione separatore magnetico", status: "PIANIFICATO", priority: 2, channel: "whatsapp", tech: 2 },
  { title: "Revisione impianto idraulico", status: "PIANIFICATO", priority: 3, channel: "portale", tech: 0 },
  { title: "Riparazione nastro trasportatore", status: "IN_CORSO", priority: 1, channel: "telegram", tech: 4 },
  { title: "Sostituzione coltelli rotore", status: "IN_CORSO", priority: 2, channel: "whatsapp", tech: 1 },
  { title: "Tarature sensori vibrazione", status: "COMPLETATO", priority: 3, channel: "portale", tech: 2 },
  { title: "Allineamento alberi motore", status: "COMPLETATO", priority: 2, channel: "portale", tech: 3 },
  { title: "Sostituzione bobine inverter", status: "FATTURATO", priority: 2, channel: "portale", tech: 2 },
];

async function main() {
  console.log("🔧 Seed Service (ancorato all'anagrafica reale)…\n");

  // 1) Zona ai tecnici
  const techs = await prisma.user.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  for (let i = 0; i < techs.length && i < ZONE.length; i++) {
    if (!techs[i].zona) await prisma.user.update({ where: { id: techs[i].id }, data: { zona: ZONE[i] } });
  }
  const techIds = techs.map((t) => t.id);
  console.log(`  zone assegnate a ${Math.min(techs.length, ZONE.length)} tecnici`);

  // 2) Macchine reali su cui ancorare gli interventi (preferibilmente in esercizio)
  let machines = await prisma.machine.findMany({
    where: { customerId: { not: null }, status: { in: ["INSTALLED", "MAINTENANCE"] } },
    take: TEMPLATES.length,
    include: { customerRef: true },
  });
  if (machines.length < TEMPLATES.length) {
    const extra = await prisma.machine.findMany({
      where: { customerId: { not: null }, id: { notIn: machines.map((m) => m.id) } },
      take: TEMPLATES.length - machines.length,
      include: { customerRef: true },
    });
    machines = [...machines, ...extra];
  }
  if (machines.length === 0) {
    console.log("  ⚠️ Nessuna macchina con cliente collegato: esegui prima `npm run service:backfill-customers`.");
    return;
  }

  // 3) Garantisce un Site (con geo) per ogni cliente coinvolto
  const siteByCustomer: Record<string, string> = {};
  for (let i = 0; i < machines.length; i++) {
    const m = machines[i];
    const custId = m.customerId!;
    if (siteByCustomer[custId]) continue;
    let site = await prisma.site.findFirst({ where: { customerId: custId } });
    if (!site) {
      const cc = m.customerRef?.countryCode ?? "IT";
      const base = GEO[cc] ?? GEO.IT;
      site = await prisma.site.create({
        data: {
          customerId: custId,
          name: `Stabilimento ${m.customerRef?.city ?? m.customerRef?.name ?? ""}`.trim(),
          city: m.customerRef?.city ?? null,
          province: m.customerRef?.province ?? null,
          lat: base[0] + (i % 7) * 0.18,
          lng: base[1] + (i % 5) * 0.22,
          status: "ok",
        },
      });
    }
    siteByCustomer[custId] = site.id;
  }
  console.log(`  cantieri garantiti per ${Object.keys(siteByCustomer).length} clienti reali`);

  // 4) Interventi: crea se assenti, altrimenti ri-aggancia (reconcile)
  const existing = await prisma.intervento.findMany({ orderBy: { createdAt: "asc" } });

  function dataFor(i: number) {
    const t = TEMPLATES[i % TEMPLATES.length];
    const m = machines[i % machines.length];
    const custId = m.customerId!;
    return {
      title: t.title,
      status: t.status,
      priority: t.priority,
      channel: t.channel,
      customerId: custId,
      siteId: siteByCustomer[custId],
      machineId: m.id,
      assignedTechId: t.status === "NUOVO" && t.priority === 3 ? null : techIds[t.tech] ?? null,
      completedAt: t.status === "COMPLETATO" || t.status === "FATTURATO" ? new Date() : null,
      startedAt: t.status === "IN_CORSO" ? new Date() : null,
    };
  }

  if (existing.length === 0) {
    for (let i = 0; i < TEMPLATES.length; i++) {
      await prisma.intervento.create({ data: { code: `INT-${2440 + i}`, ...dataFor(i) } });
    }
    console.log(`  creati ${TEMPLATES.length} interventi su macchine reali`);
  } else {
    for (let i = 0; i < existing.length; i++) {
      const d = dataFor(i);
      await prisma.intervento.update({
        where: { id: existing[i].id },
        data: { customerId: d.customerId, siteId: d.siteId, machineId: d.machineId },
      });
    }
    console.log(`  ri-agganciati ${existing.length} interventi a macchine/clienti reali`);
  }

  // 5) Rimuove i clienti mock del prototipo (ora non più referenziati)
  const del = await prisma.customer.deleteMany({ where: { code: { in: MOCK_CODES } } });
  if (del.count > 0) console.log(`  rimossi ${del.count} clienti mock`);

  // 6) Pianificazione demo: scheduledStart agli interventi con tecnico
  const daPianificare = await prisma.intervento.findMany({
    where: { assignedTechId: { not: null }, scheduledStart: null },
    orderBy: { priority: "asc" },
  });
  const dayByTech: Record<string, number> = {};
  const base = new Date();
  base.setHours(9, 0, 0, 0);
  let pianificati = 0;
  for (const it of daPianificare) {
    const tech = it.assignedTechId!;
    const offset = dayByTech[tech] ?? (Object.keys(dayByTech).length % 3);
    dayByTech[tech] = offset + 2;
    const start = new Date(base);
    start.setDate(base.getDate() + offset);
    const end = new Date(start);
    end.setHours(start.getHours() + 3);
    await prisma.intervento.update({ where: { id: it.id }, data: { scheduledStart: start, scheduledEnd: end } });
    pianificati += 1;
  }
  if (pianificati > 0) console.log(`  pianificati ${pianificati} interventi (demo)`);

  // 7) Conversazione demo (portale nativo) agganciata a un intervento in corso
  const convCount = await prisma.conversation.count();
  if (convCount === 0) {
    const it = await prisma.intervento.findFirst({
      where: { status: "IN_CORSO" },
      include: { customer: true },
    });
    if (it) {
      const conv = await prisma.conversation.create({
        data: {
          title: it.title,
          channel: "native",
          contactName: "Referente cliente",
          customerId: it.customerId,
          machineId: it.machineId,
          interventoId: it.id,
          lastMessageAt: new Date(),
        },
      });
      const t0 = new Date();
      await prisma.message.createMany({
        data: [
          { conversationId: conv.id, direction: "IN", authorName: "Referente cliente", body: "Buongiorno, l'impianto si è fermato stamattina.", source: "native", sentAt: new Date(t0.getTime() - 3600_000) },
          { conversationId: conv.id, direction: "OUT", authorName: "ZATO Service", body: "Ricevuto, apriamo l'intervento e mandiamo un tecnico in giornata.", source: "native", sentAt: new Date(t0.getTime() - 1800_000) },
          { conversationId: conv.id, direction: "IN", authorName: "Referente cliente", body: "Perfetto, grazie.", source: "native", sentAt: t0 },
        ],
      });
      console.log("  creata 1 conversazione demo (portale)");
    }
  }

  // 7b) Badge ai tecnici + presenze live demo (sugli interventi in corso)
  for (let i = 0; i < techs.length; i++) {
    if (!techs[i].badgeId) {
      await prisma.user.update({
        where: { id: techs[i].id },
        data: { badgeId: `B-${String(i + 1).padStart(3, "0")}` },
      });
    }
  }
  const presCount = await prisma.techPresence.count({ where: { clockOut: null } });
  if (presCount === 0) {
    const inCorso = await prisma.intervento.findMany({
      where: { status: "IN_CORSO", assignedTechId: { not: null }, machineId: { not: null } },
      include: { machine: { select: { job: true } } },
    });
    for (const it of inCorso) {
      await prisma.techPresence.create({
        data: {
          userId: it.assignedTechId,
          commessa: it.machine?.job ?? null,
          siteId: it.siteId,
          status: "on_site",
          source: "manual",
        },
      });
    }
    if (inCorso.length > 0) console.log(`  create ${inCorso.length} presenze live demo`);
  }

  // 8) Knowledge base demo
  const kbCount = await prisma.knowledgeArticle.count();
  if (kbCount === 0) {
    await prisma.knowledgeArticle.createMany({
      data: [
        {
          title: "Sostituzione martelli BLUE DEVIL — procedura",
          category: "Manutenzione",
          tags: ["martelli", "usura", "trituratore"],
          plantType: "BLUE DEVIL",
          pinned: true,
          authorName: "ZATO Service",
          body: "# Sostituzione martelli\n\nProcedura di sostituzione dei martelli del corpo trituratore.\n\n- Mettere l'impianto in sicurezza (LOTO).\n- Aprire il portello di ispezione.\n- Verificare l'usura di ogni martello e dell'albero porta-martelli.\n- Sostituire i martelli usurati in coppia per mantenere il bilanciamento.\n- Serrare alla coppia prevista e verificare il gioco.\n\n## Note\nAnnotare le matricole sostituite nel diario del fascicolo macchina.",
        },
        {
          title: "Allarme temperatura cuscinetti — diagnosi",
          category: "Diagnostica",
          tags: ["temperatura", "cuscinetti", "allarme"],
          authorName: "ZATO Service",
          body: "# Allarme temperatura cuscinetti\n\nCause comuni e controlli.\n\n- Verificare il livello e lo stato del lubrificante.\n- Controllare l'allineamento degli alberi.\n- Ispezionare i sensori PT100 e il cablaggio.\n- Confrontare il trend SCADA prima di intervenire.",
        },
        {
          title: "Linea grafica e brand ZATO",
          category: "Generale",
          tags: ["brand", "design"],
          authorName: "ZATO Service",
          body: "# Brand ZATO\n\nBlu navy, accento #2f6aed, font Inter. Mantenere coerenza con la dashboard aziendale.",
        },
      ],
    });
    console.log("  creati 3 articoli Knowledge demo");
  }

  console.log("\n✅ Fatto: modulo Service ancorato all'anagrafica reale.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
