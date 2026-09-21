/**
 * Scarica lo storico del timbratore nella tabella Stamping (analisi ore).
 * Il server lo fa da solo al primo avvio a tabella vuota; questo serve per
 * rifare un anno dopo correzioni massicce nel timbratore.
 *
 *   npm run timbratore:storico            → dal 2024 a oggi
 *   npm run timbratore:storico 2025 2026  → solo gli anni indicati
 *
 * `--conditions=react-server` (nello script npm) neutralizza `server-only`,
 * che altrimenti fa fallire l'import di presenceFeed da riga di comando.
 */
import "dotenv/config";
import { syncStampingHistory } from "../src/lib/presenceFeed";

(async () => {
  const now = new Date().getFullYear();
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  const list = years.length ? years : Array.from({ length: now - 2024 + 1 }, (_, i) => 2024 + i);
  for (const y of list) {
    const r = await syncStampingHistory(`${y}-01-01`, `${y}-12-31`);
    console.log(`${y}: ${r.fetched} timbrature · ${r.pages} pagine · rimosse ${r.removed}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
