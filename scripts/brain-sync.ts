/**
 * Manutenzione dello ZATO Brain da riga di comando.
 *
 *   npm run brain:seed    → popola il dizionario tecnico con le voci di partenza
 *   npm run brain:sync    → reindicizza il corpus operativo (rapportini, chat, diari, articoli)
 *   npm run brain:pending → riprova l'indicizzazione dei documenti rimasti in coda o falliti
 *
 * Il comando `sync` è quello da agganciare a un cron notturno sulla VPS: è
 * idempotente e rilavora solo ciò che è cambiato.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { seedGlossary } from "../src/lib/brain/glossary";
import { syncCorpus } from "../src/lib/brain/corpus";
import { indexPending } from "../src/lib/brain/indexer";

async function main() {
  const cmd = process.argv[2] ?? "sync";

  if (cmd === "seed") {
    const created = await seedGlossary();
    console.log(`Dizionario: ${created} termini aggiunti.`);
    return;
  }

  if (cmd === "pending") {
    const { done, failed } = await indexPending(200);
    console.log(`Indicizzazione: ${done} completate, ${failed} fallite.`);
    return;
  }

  if (cmd === "sync") {
    const r = await syncCorpus();
    const line = (name: string, s: { created: number; updated: number; skipped: number; indexed: number }) =>
      `  ${name.padEnd(12)} nuovi ${s.created}, aggiornati ${s.updated}, invariati ${s.skipped}, indicizzati ${s.indexed}`;
    console.log("Corpus ZATO Brain sincronizzato:");
    console.log(line("rapportini", r.rapportini));
    console.log(line("chat", r.chat));
    console.log(line("diari", r.diari));
    console.log(line("articoli", r.articoli));
    console.log(`  durata ${(r.durationMs / 1000).toFixed(1)}s`);
    return;
  }

  console.error(`Comando sconosciuto: ${cmd}. Usa seed | sync | pending.`);
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
