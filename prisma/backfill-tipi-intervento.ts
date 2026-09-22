/**
 * Conversione dei tipi di intervento alla classificazione commerciale.
 *
 * La vecchia targhettizzazione diceva **cosa si fa** (manutenzione, riparazione,
 * sostituzione…), la nuova dice **chi paga**: Installazione · Intervento a
 * pagamento · Intervento in garanzia · Servizi.
 *
 * Fra le due non c'è una corrispondenza esatta: una riparazione può essere a
 * pagamento o in garanzia, e questo lo sa solo chi ha seguito il cantiere.
 * Quindi la conversione porta tutto il lavoro tecnico su **a pagamento** — il
 * caso normale — e **stampa l'elenco degli interventi da rivedere a mano**:
 * quelli in garanzia vanno corretti dalla scheda, uno per uno. Meglio una
 * lista corta da controllare che un dato commerciale inventato.
 *
 *   npx tsx prisma/backfill-tipi-intervento.ts [--dry]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** vecchio tipo → nuovo tipo. INSTALLAZIONE resta com'è (la usa anche la
 *  milestone "Installata" in src/lib/milestoneAuto.ts). */
const MAP: Record<string, string> = {
  // il collaudo/completamento è la coda di una messa in servizio
  COLLAUDO: "INSTALLAZIONE",
  // lavoro tecnico: normalmente fatturato — da rivedere se era in garanzia
  MANUTENZIONE: "PAGAMENTO",
  RIPARAZIONE: "PAGAMENTO",
  SOSTITUZIONE: "PAGAMENTO",
  // prestazioni che non sono né una messa in servizio né una riparazione
  FORMAZIONE: "SERVIZI",
  TAGLIO: "SERVIZI",
  ALTRO: "SERVIZI",
};

/** Convertiti d'ufficio a "a pagamento": vanno guardati a uno a uno. */
const DA_RIVEDERE = new Set(["MANUTENZIONE", "RIPARAZIONE", "SOSTITUZIONE"]);

async function main() {
  const dry = process.argv.includes("--dry");

  const interventi = await prisma.intervento.findMany({
    where: { type: { in: Object.keys(MAP) } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, title: true, type: true, deletedAt: true },
  });

  if (!interventi.length) {
    console.log("Nessun intervento con un tipo della vecchia classificazione.");
    return;
  }

  const rivedere: string[] = [];
  for (const i of interventi) {
    const to = MAP[i.type];
    console.log(`${i.code}  ${i.type} → ${to}${i.deletedAt ? "  (cestino)" : ""}`);
    if (DA_RIVEDERE.has(i.type)) rivedere.push(`${i.code} — ${i.title}`);
    if (!dry) await prisma.intervento.update({ where: { id: i.id }, data: { type: to } });
  }

  console.log(
    `\n${dry ? "[prova a secco] " : ""}Interventi convertiti: ${interventi.length}`
  );
  if (rivedere.length) {
    console.log(
      `\nDa rivedere a mano (messi su "Intervento a pagamento": se erano in garanzia` +
        ` vanno corretti dalla scheda):`
    );
    for (const r of rivedere) console.log(`  · ${r}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
