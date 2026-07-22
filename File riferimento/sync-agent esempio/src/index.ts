// Sync Agent - Entry point
//
// Sincronizza Revenues e Backlog dai DB del gestionale (ZATO + ZATONA) al
// dashboard (finance.zatospa.it) via HTTPS.
//
// Uso:
//   npm start                          (sync default: revenues [anno corrente + precedente] + backlog snapshot oggi)
//   npm start -- --revenues            (solo revenues, [anno corrente + precedente])
//   npm start -- --revenues --year 2024 (solo 2024)
//   npm start -- --backlog             (solo backlog, snapshot = oggi)
//   npm start -- --backlog --snapshot 2026-05-20
//   npm start -- --discover --db ZATO  (lista tabelle di un DB - debug)
//   npm start -- --find-customer --db ZATO "Zato North America"

import './env-loader';
import './polyfill';
import * as fs from 'fs';
import * as path from 'path';
import { config, validateConfig } from './config';
import {
  getRevenuesForYear,
  getBacklog,
  discoverTables,
  describeTables,
  findCustomerByName,
  inspectDwarehe,
  inspectOrder,
  countRevenuesWhere,
  closeAllPools,
} from './sqlserver';
import {
  mapRevenueRow,
  mapBacklogRow,
  type RevenuePayload,
  type BacklogPayload,
} from './mapper';
import {
  fetchExchangeRates,
  pushRevenues,
  pushBacklog,
} from './api-client';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logErr(msg: string): void {
  console.error(`[${new Date().toISOString()}] ERRORE: ${msg}`);
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// Lock file: previene run sovrapposti se la schedulazione e' aggressiva
// (es. ogni 5 minuti) e un sync sta ancora girando.
// ============================================================

const LOCK_FILE = path.resolve(process.cwd(), '.sync.lock');
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 min: oltre, lock e' considerato orfano

function acquireLock(): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const content = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const lockedAt = parseInt(content, 10);
      if (!isNaN(lockedAt) && Date.now() - lockedAt < LOCK_STALE_MS) {
        return false; // lock fresco: un altro sync sta girando
      }
      // lock stantio (>30 min): probabilmente un crash, lo rimuoviamo
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // se non riusciamo a leggerlo/rimuoverlo, prudenziale: rifiuta
      return false;
    }
  }
  try {
    fs.writeFileSync(LOCK_FILE, String(Date.now()), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // gia' rimosso o mai creato: ignoriamo
  }
}

// ============================================================
// SYNC REVENUES
// ============================================================

async function syncRevenues(year: number): Promise<void> {
  log(`--- SYNC REVENUES anno ${year} ---`);

  // Per la conversione ci servono i rate USD dell'anno richiesto.
  log(`Lettura tassi di cambio USD/EUR per ${year}...`);
  const rates = await fetchExchangeRates('USD', year);
  const ratesSummary = Object.entries(rates)
    .map(([m, r]) => `m${m}=${r}`)
    .join(', ');
  log(`  Rate disponibili: ${ratesSummary || '(nessuno)'}`);

  const allRows: RevenuePayload[] = [];
  let totalRaw = 0;
  let totalFiltered = 0;
  let totalDroppedNoRate = 0;

  for (const db of config.databases) {
    log(`Query DB ${db.database} (codditt=${db.codditt}, currency=${db.currency})...`);
    const rawRows = await getRevenuesForYear(db, year);
    totalRaw += rawRows.length;
    log(`  ${rawRows.length} righe raw`);

    let mapped = 0;
    let filtered = 0;
    let droppedNoRate = 0;

    for (const raw of rawRows) {
      // Per DB USD verifichiamo che ci sia un rate per il mese.
      const needsRate = db.currency === 'USD';
      const hasRate = needsRate ? rates[String(raw.mese)] !== undefined : true;

      if (
        db.excludeCustomerAnConto &&
        raw.an_conto !== null &&
        String(raw.an_conto).trim() === String(db.excludeCustomerAnConto).trim()
      ) {
        filtered++;
        continue;
      }

      if (needsRate && !hasRate) {
        droppedNoRate++;
        continue;
      }

      const payload = mapRevenueRow(raw, db, rates);
      if (payload) {
        allRows.push(payload);
        mapped++;
      }
    }

    totalFiltered += filtered;
    totalDroppedNoRate += droppedNoRate;
    log(
      `  mappate: ${mapped}, filtrate (cliente escluso): ${filtered}, ` +
        `scartate (rate USD mancante): ${droppedNoRate}`
    );
  }

  log(`Totale righe pronte per il push: ${allRows.length} (raw: ${totalRaw})`);
  if (totalFiltered > 0) log(`  Filtrate per cliente escluso: ${totalFiltered}`);
  if (totalDroppedNoRate > 0) {
    logErr(
      `${totalDroppedNoRate} righe ZATONA scartate per mancanza di rate. ` +
        `Inserisci i cambi mancanti su /dashboard/admin/exchange-rates e rilancia.`
    );
  }

  log(`Invio ${allRows.length} record a ${config.api.revenuesUrl}...`);
  const result = await pushRevenues(allRows, year);
  log(`Revenues sync completato: ${result.status}`);
  log(`  Cancellati anno ${year}: ${result.results.deleted}`);
  log(`  Inseriti:                ${result.results.inserted}`);
  log(`  Durata server-side:      ${result.durationMs}ms`);
}

// ============================================================
// SYNC BACKLOG
// ============================================================

async function syncBacklog(snapshotDate: string): Promise<void> {
  log(`--- SYNC BACKLOG snapshot ${snapshotDate} ---`);

  // Anno dello snapshot per fetch dei rate
  const snapshotYear = parseInt(snapshotDate.slice(0, 4), 10);
  log(`Lettura tassi di cambio USD/EUR per ${snapshotYear} (rif. snapshot)...`);
  const rates = await fetchExchangeRates('USD', snapshotYear);

  const allRows: BacklogPayload[] = [];
  let totalRaw = 0;
  let totalFiltered = 0;
  let totalDroppedNoRate = 0;

  for (const db of config.databases) {
    log(`Query DB ${db.database} (codditt=${db.codditt}, currency=${db.currency})...`);
    const rawRows = await getBacklog(db);
    totalRaw += rawRows.length;
    log(`  ${rawRows.length} righe raw`);

    let mapped = 0;
    let filteredCustomer = 0;
    let filteredSerie = 0;
    let droppedNoRate = 0;

    const excludeSeries = new Set(db.excludeBacklogSeries ?? []);

    for (const raw of rawRows) {
      if (
        db.excludeCustomerAnConto &&
        raw.an_conto !== null &&
        String(raw.an_conto).trim() === String(db.excludeCustomerAnConto).trim()
      ) {
        filteredCustomer++;
        continue;
      }

      if (excludeSeries.size > 0 && raw.serie_documento) {
        const serie = String(raw.serie_documento).trim().toUpperCase();
        if (excludeSeries.has(serie)) {
          filteredSerie++;
          continue;
        }
      }

      const payload = mapBacklogRow(raw, db, rates);
      if (!payload) {
        if (db.currency === 'USD') droppedNoRate++;
        continue;
      }
      allRows.push(payload);
      mapped++;
    }

    totalFiltered += filteredCustomer + filteredSerie;
    totalDroppedNoRate += droppedNoRate;
    log(
      `  mappate: ${mapped}, filtrate cliente: ${filteredCustomer}, ` +
        `filtrate serie [${[...excludeSeries].join(',')}]: ${filteredSerie}, ` +
        `scartate (rate USD mancante): ${droppedNoRate}`
    );
  }

  log(`Totale righe pronte per il push: ${allRows.length} (raw: ${totalRaw})`);
  if (totalFiltered > 0) log(`  Filtrate per cliente escluso: ${totalFiltered}`);
  if (totalDroppedNoRate > 0) {
    logErr(
      `${totalDroppedNoRate} righe ZATONA scartate per mancanza di rate. ` +
        `Inserisci i cambi mancanti su /dashboard/admin/exchange-rates e rilancia.`
    );
  }

  log(`Invio ${allRows.length} record a ${config.api.backlogUrl}...`);
  const result = await pushBacklog(allRows, snapshotDate);
  log(`Backlog sync completato: ${result.status}`);
  log(`  Cancellati snapshot ${snapshotDate}: ${result.results.deleted}`);
  log(`  Inseriti:                            ${result.results.inserted}`);
  log(`  Durata server-side:                  ${result.durationMs}ms`);
}

// ============================================================
// MAIN
// ============================================================

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

// Flag a livello modulo per coordinare lock e finally
let lockAcquired = false;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const isRevenues = args.includes('--revenues');
  const isBacklog = args.includes('--backlog');
  const isDiscover = args.includes('--discover');
  const isDescribeTables = args.includes('--describe-tables');
  const isInspectDwarehe = args.includes('--inspect-dwarehe');
  const isCountRevenues = args.includes('--count-revenues');
  const isInspectOrder = args.includes('--inspect-order');
  const isFindCustomer = args.includes('--find-customer');

  const yearArg = getArg(args, '--year');
  const year = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();
  const snapshotArg = getArg(args, '--snapshot');
  const snapshotDate = snapshotArg ?? todayIso();

  try {
    if (isDiscover) {
      const dbName = getArg(args, '--db') || 'ZATO';
      log(`Discovery tabelle DB ${dbName}`);
      const tables = await discoverTables(dbName);
      console.log(`\nTabelle (${tables.length}):`);
      tables.forEach((t) => console.log(`  ${t}`));
      return;
    }

    if (isDescribeTables) {
      const dbName = getArg(args, '--db') || 'ZATO';
      const tablesArg = getArg(args, '--tables');
      const tables = tablesArg
        ? tablesArg.split(',').map((t) => t.trim()).filter(Boolean)
        : [
            'dwarehe', 'anagra', 'artico',
            'tabzone', 'tabgmer', 'tabsgme', 'tabcate', 'tabcana',
            'movord', 'testord', 'movmag', 'testmag',
            'tabhhdf', 'tabhhuf', 'tabhhsc', 'tabhhtp', 'tabhhtm',
          ];
      log(`Describe tables in DB ${dbName}: ${tables.join(', ')}`);
      const schema = await describeTables(dbName, tables);
      for (const t of tables) {
        const cols = schema[t] || [];
        console.log(`\n=== ${t} (${cols.length} colonne) ===`);
        if (cols.length === 0) {
          console.log('  (tabella non trovata o vuota)');
          continue;
        }
        for (const c of cols) {
          console.log(`  ${c.column}  ${c.type}${c.nullable ? '' : '  NOT NULL'}`);
        }
      }
      return;
    }

    if (isInspectDwarehe) {
      const dbName = getArg(args, '--db') || 'ZATO';
      log(`Inspect dwarehe in DB ${dbName}`);
      const rows = await inspectDwarehe(dbName);
      console.log(`\n=== dwarehe in ${dbName}: ${rows.length} combinazioni ===\n`);
      console.log(
        `  codditt      scen   year    rows  rows_wValfatt  sum_valfatt   sum_quantfatt   sum_valore`
      );
      console.log(`  ` + '-'.repeat(105));
      for (const r of rows) {
        const fmt = (n: number) =>
          (Number(n) || 0).toLocaleString('it-IT', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
        console.log(
          `  ${String(r.codditt).padEnd(10)}  ${String(r.scenario).padStart(4)}  ${String(r.year).padStart(5)}  ${String(r.rows).padStart(6)}  ${String(r.rows_with_valfatt).padStart(13)}  ${fmt(r.sum_valfatt).padStart(12)}  ${fmt(r.sum_quantfatt).padStart(14)}  ${fmt(r.sum_valore).padStart(12)}`
        );
      }
      return;
    }

    if (isCountRevenues) {
      log('Count revenues con il WHERE del sync (su ciascun DB configurato)');
      const yearV = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();
      for (const db of config.databases) {
        const r = await countRevenuesWhere(
          db.database,
          db.codditt,
          config.sync.revenuesScenario,
          yearV
        );
        console.log(
          `  ${db.database} (codditt=${db.codditt}, scenario=${config.sync.revenuesScenario}, year=${yearV})`
        );
        console.log(`    Righe SENZA filtro (solo codditt+scenario+anno): ${r.rows_no_filter}`);
        console.log(`    Righe CON filtro (non-tutto-zero):               ${r.rows_with_filter}`);
      }
      return;
    }

    if (isInspectOrder) {
      const dbName = getArg(args, '--db') || 'ZATO';
      const numDoc = getArg(args, '--num');
      if (!numDoc) {
        logErr('Specifica il numero documento: --inspect-order --db ZATO --num 72');
        process.exitCode = 1;
        return;
      }
      log(`Inspect ordine numero ${numDoc} in DB ${dbName}`);
      const result = await inspectOrder(dbName, numDoc);

      console.log(`\n=== TESTORD (${result.testord.length} righe) ===`);
      if (result.testord.length === 0) {
        console.log('  Nessuna testord trovata. (Per questo la LEFT JOIN nel sync NON aggancia.)');
      } else {
        for (const t of result.testord) {
          console.log(JSON.stringify(t, null, 2));
        }
      }

      console.log(`\n=== MOVORD (${result.movord.length} righe) ===`);
      for (const m of result.movord.slice(0, 5)) {
        console.log(JSON.stringify(m, null, 2));
      }

      console.log(`\n=== DWAREHE (${result.dwarehe.length} righe) ===`);
      for (const d of result.dwarehe.slice(0, 5)) {
        console.log(JSON.stringify(d, null, 2));
      }
      return;
    }

    if (isFindCustomer) {
      const dbName = getArg(args, '--db') || 'ZATO';
      const needle = args[args.length - 1];
      if (!needle || needle.startsWith('--')) {
        logErr('Specifica il testo da cercare come ultimo argomento');
        process.exitCode = 1;
        return;
      }
      log(`Ricerca cliente "%${needle}%" in DB ${dbName}`);
      const rows = await findCustomerByName(dbName, needle);
      console.log(`\nMatch trovati (${rows.length}):`);
      rows.forEach((r) =>
        console.log(`  an_conto=${r.an_conto}  tipo=${r.an_tipo}  ${r.an_descr1}`)
      );
      return;
    }

    validateConfig();

    // Lock file: se un sync precedente sta ancora girando (es. schedulazione
    // ogni 5 min e SQL lento), saltiamo questa esecuzione invece di accavallarci.
    if (!acquireLock()) {
      log('Sync gia in corso (lock file .sync.lock presente). Esco senza fare nulla.');
      return;
    }
    lockAcquired = true;

    log('Sync agent avviato');
    log(`Target dashboard: ${config.api.baseUrl}`);
    log(
      `SQL Server: ${config.sqlserver.server}:${config.sqlserver.port}, DB: ${config.databases.map((d) => d.database).join(' + ')}`
    );

    const runRevenues = isRevenues || (!isRevenues && !isBacklog);
    const runBacklog = isBacklog || (!isRevenues && !isBacklog);

    // Range default revenues: anno corrente + anno precedente. Se --year e'
    // esplicito (anche identico al corrente), si sincronizza SOLO quell'anno.
    const currentYear = new Date().getFullYear();
    const yearsToSync = yearArg ? [year] : [currentYear, currentYear - 1];

    if (runRevenues) {
      for (const y of yearsToSync) {
        await syncRevenues(y);
      }
    }
    if (runBacklog) await syncBacklog(snapshotDate);

    log('Tutto OK.');
  } catch (err) {
    logErr(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await closeAllPools();
    if (lockAcquired) releaseLock();
    log('Agent terminato.');
  }
}

main();
