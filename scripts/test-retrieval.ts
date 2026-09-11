/**
 * Suite di regressione del retrieval.
 *
 * Ogni correzione al ranking rischia di risolvere una domanda e romperne
 * un'altra: e' successo tre volte di fila. Qui si fissa il comportamento atteso
 * su domande reali. Gira nel container (serve DB + ANTHROPIC_API_KEY):
 *
 *   docker compose run --rm tools npx tsx scripts/test-retrieval.ts
 */
import "dotenv/config";
import { planQuery, retrieve } from "@/lib/brain/retrieve";
import { loadGlossary } from "@/lib/brain/glossary";
import { prisma } from "@/lib/db";

/** domanda → pezzo di breadcrumb che DEVE comparire fra i primi N risultati */
const CASI: { domanda: string; attesa: string; entro?: number }[] = [
  { domanda: "come devo fare ad accendere l'impianto del mio blue devil", attesa: "6.2.1 Accensione" },
  { domanda: "Quali controlli preliminare devo fare prima di avviare un Blue Devil?", attesa: "Controlli preliminari" },
  { domanda: "quali DPI servono per la manutenzione", attesa: "MISURE DI SICUREZZA" },
  { domanda: "come si arresta l'impianto in emergenza", attesa: "Arresto di emergenza" },
];

(async () => {
  const g = await loadGlossary();
  let ok = true;
  for (const c of CASI) {
    const entro = c.entro ?? 5;
    const plan = await planQuery(c.domanda, [], g);
    const res = await retrieve(plan, { audience: "internal" });
    const pos = res.findIndex((r) => r.breadcrumb.includes(c.attesa));
    const buono = pos >= 0 && pos < entro;
    ok = ok && buono;
    console.log(`${buono ? "OK " : "KO "} "${c.domanda.slice(0, 52)}"`);
    console.log(`      attesa "${c.attesa}" → ${pos < 0 ? "NON TROVATA" : "posizione " + (pos + 1)}`);
    if (!buono)
      for (const r of res.slice(0, 4))
        console.log(`         ${r.score.toFixed(2)} p.${r.page} ${r.breadcrumb.slice(-46)}`);
  }
  console.log(ok ? "\nTutti i casi passano." : "\nCI SONO REGRESSIONI.");
  await prisma.$disconnect();
  process.exitCode = ok ? 0 : 1;
})();
