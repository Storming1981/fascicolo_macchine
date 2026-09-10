import { stripRunningHeaders } from "@/lib/brain/extract";

/** Riproduce il GF4000: titoli di sezione UNICI, testata di manuale ripetuta su
 *  tutte le pagine, e le due varianti del pie' di pagina (nativo e da OCR). */
const SEZIONI = ["5.7 PRIMO AVVIAMENTO", "6.2.1 Accensione", "7.1 MISURE DI SICUREZZA", "3.2 NORME GENERALI"];
const pages = Array.from({ length: 105 }, (_, i) => {
  const n = i + 1;
  const sezione = `${SEZIONI[i % 4]} — pagina ${n}`; // titolo diverso a ogni pagina
  const testata = "MANUALE DI USO E MANUTENZIONE";
  // Una pagina vera ha decine di righe, non tre: con poche righe la finestra di
  // bordo coprirebbe tutta la pagina e il test non direbbe nulla di utile.
  const corpo = Array.from(
    { length: 22 },
    (_, k) => `Riga ${k + 1} di contenuto tecnico della pagina ${n}: la procedura vera che deve sopravvivere.`
  ).join("\n");
  const footer =
    n % 2 === 0
      ? `BLUE DEVIL\nGF 4000 II ${n} / 105 Versione 01 - Revisione 1.0`
      : `BLUE DEVIL\nGF 4000 II\n${n} / 105\nVersione 01 - Revisione 1.0`;
  return { page: n, text: `${testata}\n${sezione}\n${corpo}\n${footer}` };
});

const rimosse = stripRunningHeaders(pages);
const conta = (re: RegExp) => pages.filter((p) => re.test(p.text)).length;

const esiti: [string, number, number][] = [
  ["pie' di pagina residui", conta(/Versione 01/), 0],
  ['righe "BLUE DEVIL"', conta(/BLUE DEVIL/), 0],
  ["testata di manuale residua", conta(/MANUALE DI USO/), 0],
  ["titoli di sezione intatti", conta(/^.*\d+(\.\d+)*\s/m), 105],
  ["contenuto tecnico intatto", conta(/procedura vera/), 105],
];
console.log(`righe rimosse: ${rimosse}\n`);
let ok = true;
for (const [nome, val, atteso] of esiti) {
  const buono = val === atteso;
  ok = ok && buono;
  console.log(`${buono ? "OK " : "KO "} ${nome.padEnd(28)} ${val} (atteso ${atteso})`);
}
console.log("\nesempio pagina 67:\n" + JSON.stringify(pages[66].text));
process.exitCode = ok ? 0 : 1;

/* ── Riconoscimento dei titoli di sezione ─────────────────────────────────
   Una voce di elenco numerata NON e' un titolo: scambiarla per tale spezza la
   procedura in un frammento per passo e stacca i passi dal capitolo che li
   introduce, cioe' dalla parola con cui l'operatore li cerca. */
import { headingOf } from "@/lib/brain/chunk";

const casi: [string, boolean][] = [
  ["6.2.1 Accensione", true],
  ["5.7 PRIMO AVVIAMENTO", true],
  ["7 MANUTENZIONE", true],
  ["MANUALE DI USO E MANUTENZIONE", true],
  ["1. Aprire l'accesso principale", false],
  ["2. Portare l'interruttore GENERAL1 in \"ON\";", false],
  ["10. Mantenere premuto per 2 secondi il pulsante ON;", false],
  ["3. Verificare che la spia POWER sia accesa;", false],
];

console.log("\n--- riconoscimento titoli ---");
let ok2 = true;
for (const [riga, atteso] of casi) {
  const esito = headingOf(riga) !== null;
  const buono = esito === atteso;
  ok2 = ok2 && buono;
  console.log(`${buono ? "OK " : "KO "} ${atteso ? "titolo    " : "elenco    "} ${riga}`);
}
if (!ok2) process.exitCode = 1;
