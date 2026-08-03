// Sync-agent ERP - entry point.
//
// Legge i dati di produzione dei fascicoli dal gestionale ZATO (SQL Server) e
// li invia all'app machines.zatospa.it via HTTPS. Gira in azienda (LAN con
// accesso al SQL Server); l'app sulla VPS non vede il gestionale.
//
// Flusso:
//   1. GET  /api/sync/erp/machines  -> lista fascicoli (job, ordini)
//   2. per ciascuno: query SQL Server -> dati aggregati (getMachineErpData)
//   3. POST /api/sync/erp            -> invio a batch
//
// Uso:
//   npm start                    (catalogo articoli + fascicoli)
//   npm start -- --test-conn     (solo test connessione SQL + API, nessuna scrittura)
//   npm start -- --dry-run       (interroga il gestionale ma NON invia all'app)
//   npm start -- --limit 10      (solo i primi 10 fascicoli, per prove)
//   npm start -- --only-articles (solo il catalogo ricambi)
//   npm start -- --skip-articles (solo i fascicoli, salta il catalogo)

import './env-loader';
import './polyfill';
import * as fs from 'fs';
import * as path from 'path';
import { config, validateConfig } from './config';
import {
  closePool,
  getAllArticles,
  getAllCustomers,
  getCommessaOrders,
  getMachineErpData,
  testConnection,
  GENERIC_COMMESSA,
  type ErpMachineData,
} from './erp';
import {
  fetchMachines,
  pushArticles,
  pushCustomers,
  pushOrders,
  pushResults,
  type CustomerPush,
  type MachineRow,
  type PushResult,
} from './api-client';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
function logErr(msg: string): void {
  console.error(`[${new Date().toISOString()}] ERRORE: ${msg}`);
}

// ── Lock file: niente run sovrapposti ──────────────────────────────────────

const LOCK_FILE = path.resolve(process.cwd(), '.sync.lock');
const LOCK_STALE_MS = 30 * 60 * 1000;
let lockAcquired = false;

function acquireLock(): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockedAt = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (!isNaN(lockedAt) && Date.now() - lockedAt < LOCK_STALE_MS) return false;
      fs.unlinkSync(LOCK_FILE);
    } catch {
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
    /* già rimosso */
  }
}

function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Serializza ErpMachineData nello snapshot JSON atteso dalla card ERP (date ISO). */
function buildSnapshot(erp: ErpMachineData): Record<string, unknown> {
  return {
    jobs: erp.jobs.map((j) => ({
      job: j.job,
      found: j.found,
      description: j.description,
      customer: j.customer,
      customerCountryIso: j.customerCountryIso,
      openedAt: iso(j.openedAt),
      closedAt: iso(j.closedAt),
      isClosed: j.isClosed,
      productionStart: iso(j.productionStart),
      productionEnd: iso(j.productionEnd),
      progressRows: j.progressRows,
      hours: j.hours,
    })),
    orders: erp.orders.map((o) => ({
      role: o.role,
      data: {
        key: o.data.key,
        found: o.data.found,
        tipork: o.data.tipork,
        anno: o.data.anno,
        serie: o.data.serie,
        num: o.data.num,
        hours: o.data.hours,
        start: iso(o.data.start),
        end: iso(o.data.end),
        articles: o.data.articles.map((a) => ({
          code: a.code,
          desc: a.desc,
          hours: a.hours,
          rows: a.rows,
          start: iso(a.start),
          end: iso(a.end),
        })),
      },
    })),
    productionStart: iso(erp.productionStart),
    productionEnd: iso(erp.productionEnd),
    totalHours: erp.totalHours,
    hasProduction: erp.hasProduction,
  };
}

/** Esegue `worker` su `items` con al più `limit` in parallelo. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(runners);
  return out;
}

// ── Sync catalogo articoli/ricambi ─────────────────────────────────────────

async function runSyncArticles(dryRun: boolean): Promise<void> {
  log('Leggo il catalogo articoli dal gestionale (artico) ...');
  const articles = await getAllArticles();
  log(`  ${articles.length} articoli letti`);

  if (dryRun) {
    log('--dry-run: NON invio il catalogo. Anteprima primi 5:');
    for (const a of articles.slice(0, 5)) log(`  ${a.code}  ${a.description}`);
    return;
  }

  const size = config.sync.articlesBatchSize;
  let inserted = 0;
  let total = 0;
  for (let i = 0; i < articles.length; i += size) {
    const chunk = articles.slice(i, i + size);
    // Il primo chunk azzera il catalogo (replace), i successivi accodano.
    const resp = await pushArticles(chunk, i === 0);
    inserted += resp.inserted;
    total = resp.totalInCatalog;
    log(`  inviati ${Math.min(i + size, articles.length)}/${articles.length}`);
  }
  log(`Catalogo articoli aggiornato: ${inserted} inseriti, ${total} totali sulla piattaforma`);
}

// ── Sync principale ────────────────────────────────────────────────────────

async function runSync(opts: { dryRun: boolean; limit: number | null }): Promise<void> {
  log(`Scarico la lista fascicoli da ${config.api.machinesUrl} ...`);
  let machines = await fetchMachines();
  log(`  ${machines.length} fascicoli ricevuti`);
  if (opts.limit != null) {
    machines = machines.slice(0, opts.limit);
    log(`  (limitato a ${machines.length} per --limit)`);
  }

  log(`Interrogo il gestionale (concorrenza ${config.sync.concurrency}) ...`);
  let queried = 0;
  const results: PushResult[] = await mapLimit(
    machines,
    config.sync.concurrency,
    async (m: MachineRow) => {
      try {
        const erp = await getMachineErpData({
          job: m.job,
          jobBody: m.jobBody,
          jobContainer: m.jobContainer,
          bodyOrder: m.erpBodyOrder,
          containerOrder: m.erpContainerOrder,
          standOrder: m.erpStandOrder,
          bladesOrder: m.erpBladesOrder,
        });
        return {
          id: m.id,
          found: erp.found,
          customer: erp.customer,
          customerConto: erp.customerConto,
          customerCountryIso: erp.customerCountryIso,
          customerCountryName: erp.customerCountryName,
          description: erp.description,
          totalHours: erp.totalHours,
          productionStart: iso(erp.productionStart),
          productionEnd: iso(erp.productionEnd),
          snapshot: buildSnapshot(erp),
        } as PushResult;
      } catch (e) {
        logErr(`fascicolo ${m.code}: ${e instanceof Error ? e.message : String(e)}`);
        return { id: m.id, found: false } as PushResult;
      } finally {
        queried++;
        if (queried % 25 === 0) log(`  interrogati ${queried}/${machines.length}`);
      }
    },
  );

  const matched = results.filter((r) => r.found).length;
  log(`Gestionale: ${matched}/${results.length} fascicoli con commessa trovata`);

  if (opts.dryRun) {
    log('--dry-run: NON invio nulla all\'app. Anteprima primi 5:');
    for (const r of results.filter((x) => x.found).slice(0, 5)) {
      log(
        `  ${r.id}  cliente=${r.customer ?? '—'}  ore=${r.totalHours ?? 0}  ` +
          `prod=${r.productionStart ?? '—'}→${r.productionEnd ?? '—'}`,
      );
    }
    return;
  }

  // 1) Anagrafica clienti COMPLETA (anagra, an_tipo='C'): inviata PRIMA delle
  //    macchine, così il collegamento macchina→cliente (per erpConto) aggancia.
  log('Anagrafica clienti: lettura completa da anagra ...');
  const allCustomers = await getAllCustomers();
  log(`  ${allCustomers.length} clienti letti`);
  const custBatch = config.sync.articlesBatchSize; // stesso blocco (default 1000)
  let custUpserted = 0;
  let custTotal = 0;
  for (let i = 0; i < allCustomers.length; i += custBatch) {
    const chunk: CustomerPush[] = allCustomers.slice(i, i + custBatch).map((d) => ({
      conto: d.conto,
      name: d.name,
      address: d.address,
      city: d.city,
      province: d.province,
      countryIso: d.countryIso,
      countryName: d.countryName,
    }));
    const cResp = await pushCustomers(chunk);
    custUpserted += cResp.upserted;
    custTotal = cResp.total;
    log(`  inviati ${Math.min(i + custBatch, allCustomers.length)}/${allCustomers.length}`);
  }
  log(`Clienti aggiornati: ${custUpserted} creati/aggiornati, ${custTotal} totali sulla piattaforma`);

  // 2) Invio fascicoli a batch (con customerConto → collegamento cliente)
  const batchSize = config.sync.batchSize;
  let sent = 0;
  let updated = 0;
  let withProduction = 0;
  let linked = 0;
  let errorCount = 0;
  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    log(`Invio batch ${i / batchSize + 1} (${batch.length} fascicoli) a ${config.api.pushUrl} ...`);
    const resp = await pushResults(batch);
    sent += resp.results.received;
    updated += resp.results.updated;
    withProduction += resp.results.withProduction;
    linked += resp.results.linked ?? 0;
    errorCount += resp.results.errorCount;
    if (resp.errors.length) {
      for (const e of resp.errors.slice(0, 5)) logErr(`  push ${e.id}: ${e.error}`);
    }
  }

  // 3) Elenco ordini di produzione della commessa generica (999999999), per le
  //    tendine "Ordine Corpo/Container" degli impianti nuovi sulla VPS.
  try {
    log('Ordini di produzione commessa generica ...');
    const genOrders = await getCommessaOrders(GENERIC_COMMESSA);
    const payload = genOrders.map((o) => ({
      key: o.key,
      tipork: o.tipork,
      anno: o.anno,
      serie: o.serie,
      num: o.num,
      mainArticleCode: o.mainArticleCode,
      mainArticleDesc: o.mainArticleDesc,
      hours: o.hours,
      start: iso(o.start),
      end: iso(o.end),
      rows: o.rows,
      articleCount: o.articleCount,
    }));
    const oResp = await pushOrders(GENERIC_COMMESSA, payload);
    log(`  ordini commessa ${GENERIC_COMMESSA}: ${oResp.count} sincronizzati`);
  } catch (e) {
    logErr(`ordini commessa: ${e instanceof Error ? e.message : String(e)}`);
  }

  log('--- RIEPILOGO ---');
  log(`  Fascicoli inviati:          ${sent}`);
  log(`  Aggiornati (con modifiche): ${updated}`);
  log(`  Con date di produzione:     ${withProduction}`);
  log(`  Collegati a cliente:        ${linked}`);
  log(`  Errori lato app:            ${errorCount}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isTestConn = args.includes('--test-conn');
  const dryRun = args.includes('--dry-run');
  const onlyArticles = args.includes('--only-articles');
  const skipArticles = args.includes('--skip-articles');
  const limitArg = getArg(args, '--limit');
  const limit = limitArg ? parseInt(limitArg, 10) : null;

  try {
    validateConfig();

    if (isTestConn) {
      log('Test connessione SQL Server ...');
      await testConnection();
      log('  SQL Server OK');
      log('Test API (GET lista fascicoli) ...');
      const m = await fetchMachines();
      log(`  API OK: ${m.length} fascicoli`);
      return;
    }

    if (!acquireLock()) {
      log('Sync già in corso (.sync.lock presente). Esco.');
      return;
    }
    lockAcquired = true;

    log('Sync-agent ERP avviato');
    log(`Target app:  ${config.api.baseUrl}`);
    log(`SQL Server:  ${config.sqlserver.server}:${config.sqlserver.port}/${config.sqlserver.database}`);

    // Catalogo articoli (a meno di --skip-articles). Con --only-articles fa solo questo.
    if (!skipArticles) await runSyncArticles(dryRun);
    if (!onlyArticles) await runSync({ dryRun, limit });
    log('Tutto OK.');
  } catch (err) {
    logErr(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await closePool();
    if (lockAcquired) releaseLock();
    log('Agent terminato.');
  }
}

main();
