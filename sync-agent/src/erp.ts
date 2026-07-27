// Lettura READ-ONLY dal gestionale ZATO (SQL Server, Zucchetti AdHoc).
//
// Le query sono le STESSE dell'app (src/lib/erp.ts): job = commess.co_comme,
// cliente = anagra via co_conto, paese via tabstat, produzione = avlavp
// (lce_start/stop/tempese). Qui girano on-premise perché la VPS non vede il
// SQL Server aziendale; il risultato aggregato per macchina viene poi inviato
// all'app via HTTPS.

import sql from 'mssql';
import { config } from './config';

/** Commessa "generica" del gestionale per gli impianti nuovi. */
export const GENERIC_COMMESSA = 999999999;

let poolPromise: Promise<sql.ConnectionPool> | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const cfg: sql.config = {
      server: config.sqlserver.server,
      port: config.sqlserver.port,
      user: config.sqlserver.user,
      password: config.sqlserver.password,
      database: config.sqlserver.database,
      options: config.sqlserver.options,
      pool: config.sqlserver.pool,
    };
    const pool = new sql.ConnectionPool(cfg);
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export async function closePool(): Promise<void> {
  if (poolPromise) {
    try {
      const p = await poolPromise;
      await p.close();
    } catch {
      /* già chiuso */
    }
    poolPromise = null;
  }
}

/** Verifica di connettività: SELECT 1. */
export async function testConnection(): Promise<void> {
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
}

export interface ErpArticle {
  code: string;
  description: string;
}

/**
 * Catalogo completo articoli/ricambi (tabella `artico`, codditt='ZATO'),
 * per popolare l'autocomplete del rapportino sulla VPS. Scarta i codici vuoti.
 */
export async function getAllArticles(): Promise<ErpArticle[]> {
  const pool = await getPool();
  const r = await pool.request().query<{ ar_codart: string | null; ar_descr: string | null }>(`
    SELECT ar_codart, ar_descr
    FROM artico
    WHERE codditt = 'ZATO' AND ar_codart IS NOT NULL AND LTRIM(RTRIM(ar_codart)) <> ''
    ORDER BY ar_codart ASC;
  `);
  return r.recordset.map((x) => ({
    code: (x.ar_codart ?? '').trim(),
    description: (x.ar_descr ?? '').trim(),
  }));
}

/** Converte le date "sentinella" del gestionale (1900 / 2099) in null. */
function realDate(d: Date | null | undefined): Date | null {
  if (!d) return null;
  const y = d.getFullYear();
  if (y <= 1900 || y >= 2099) return null;
  return d;
}

/** True se la stringa job è un numero (== co_comme). */
export function jobToCommeca(job: string | null | undefined): number | null {
  if (!job) return null;
  const t = String(job).trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

// ── Job / commessa ────────────────────────────────────────────────────────

export interface ErpJobData {
  job: string;
  commeca: number;
  found: boolean;
  description: string | null;
  customer: string | null;
  customerCountryIso: string | null;
  customerCountryName: string | null;
  productionStart: Date | null;
  productionEnd: Date | null;
  progressRows: number;
  hours: number;
}

export async function getJobData(job: string): Promise<ErpJobData> {
  const commeca = jobToCommeca(job);
  const base: ErpJobData = {
    job: String(job).trim(),
    commeca: commeca ?? 0,
    found: false,
    description: null,
    customer: null,
    customerCountryIso: null,
    customerCountryName: null,
    productionStart: null,
    productionEnd: null,
    progressRows: 0,
    hours: 0,
  };
  if (commeca === null) return base;

  const pool = await getPool();

  const com = await pool
    .request()
    .input('c', sql.Int, commeca)
    .query<{
      co_conto: number;
      co_descr1: string | null;
    }>(`
      SELECT TOP 1 co_conto, co_descr1
      FROM commess
      WHERE co_comme = @c;
    `);

  if (com.recordset.length === 0) return base;
  const c = com.recordset[0];

  let customer: string | null = null;
  let customerCountryIso: string | null = null;
  let customerCountryName: string | null = null;
  if (c.co_conto && c.co_conto !== 0) {
    const cli = await pool
      .request()
      .input('conto', sql.Int, c.co_conto)
      .query<{ an_descr1: string | null; iso2: string | null; country_name: string | null }>(`
        SELECT TOP 1
          a.an_descr1,
          s.tb_siglaiso AS iso2,
          s.tb_desstat  AS country_name
        FROM anagra a
        LEFT JOIN tabstat s ON s.tb_codstat = a.an_stato
        WHERE a.an_conto = @conto AND a.an_tipo = 'C';
      `);
    customer = cli.recordset[0]?.an_descr1?.trim() ?? null;
    customerCountryIso = cli.recordset[0]?.iso2?.trim() || null;
    customerCountryName = cli.recordset[0]?.country_name?.trim() || null;
  }

  const a =
    commeca === GENERIC_COMMESSA
      ? { n: 0, min_s: null as Date | null, max_e: null as Date | null, ore: 0 }
      : (
          await pool
            .request()
            .input('c', sql.Int, commeca)
            .query<{ n: number; min_s: Date | null; max_e: Date | null; ore: number | null }>(`
              SELECT COUNT(*) AS n, MIN(lce_start) AS min_s, MAX(lce_stop) AS max_e,
                     SUM(lce_tempese) AS ore
              FROM avlavp
              WHERE lce_commeca = @c;
            `)
        ).recordset[0];

  return {
    ...base,
    found: true,
    description: c.co_descr1?.trim() || null,
    customer,
    customerCountryIso,
    customerCountryName,
    productionStart: realDate(a.min_s),
    productionEnd: realDate(a.max_e),
    progressRows: a.n ?? 0,
    hours: a.ore ?? 0,
  };
}

// ── Ordini di produzione (impianti nuovi: commessa 999999999) ───────────────

export function parseOrderKey(
  key: string,
): { tipork: string; anno: number; serie: string; num: number } | null {
  const parts = String(key).split('|');
  if (parts.length !== 4) return null;
  const anno = Number(parts[1]);
  const num = Number(parts[3]);
  if (!parts[0] || !Number.isFinite(anno) || !Number.isFinite(num)) return null;
  return { tipork: parts[0], anno, serie: parts[2] ?? '', num };
}

export interface ErpOrderData {
  found: boolean;
  hours: number;
  start: Date | null;
  end: Date | null;
}

export async function getOrderData(orderKey: string): Promise<ErpOrderData | null> {
  const k = parseOrderKey(orderKey);
  if (!k) return null;
  const pool = await getPool();

  const agg = await pool
    .request()
    .input('t', sql.VarChar, k.tipork)
    .input('y', sql.Int, k.anno)
    .input('s', sql.VarChar, k.serie)
    .input('n', sql.Int, k.num)
    .query<{ n: number; ore: number | null; s: Date | null; e: Date | null }>(`
      SELECT COUNT(*) AS n, SUM(lce_tempese) AS ore, MIN(lce_start) AS s, MAX(lce_stop) AS e
      FROM avlavp
      WHERE lce_ortipo = @t AND lce_oranno = @y
        AND LTRIM(RTRIM(lce_orserie)) = @s AND lce_ornum = @n;
    `);

  const a = agg.recordset[0];
  if (!a || (a.n ?? 0) === 0) {
    return { found: false, hours: 0, start: null, end: null };
  }
  return {
    found: true,
    hours: a.ore ?? 0,
    start: realDate(a.s),
    end: realDate(a.e),
  };
}

// ── Aggregato per macchina (stessa logica di src/lib/erp.ts) ────────────────

export interface MachineErpInput {
  job?: string | null;
  jobBody?: string | null;
  jobContainer?: string | null;
  bodyOrder?: string | null;
  containerOrder?: string | null;
  standOrder?: string | null;
  bladesOrder?: string | null;
}

export interface ErpMachineData {
  found: boolean;
  customer: string | null;
  customerCountryIso: string | null;
  customerCountryName: string | null;
  description: string | null;
  productionStart: Date | null;
  productionEnd: Date | null;
  totalHours: number;
  hasProduction: boolean;
}

export async function getMachineErpData(input: MachineErpInput): Promise<ErpMachineData> {
  const uniqJobs = Array.from(
    new Set(
      [input.job, input.jobBody, input.jobContainer]
        .map((j) => (j ? String(j).trim() : ''))
        .filter((j) => jobToCommeca(j) !== null),
    ),
  );

  const jobs = await Promise.all(uniqJobs.map((j) => getJobData(j)));
  const found = jobs.filter((j) => j.found);
  const primary =
    found.find((j) => j.customer && j.commeca !== GENERIC_COMMESSA) ?? found[0] ?? null;

  // Ordini di produzione selezionati (corpo, container, cavalletto, lame)
  const orderInputs: { key: string | null | undefined }[] = [
    { key: input.bodyOrder },
    { key: input.containerOrder },
    { key: input.standOrder },
    { key: input.bladesOrder },
  ];
  const orders: ErpOrderData[] = [];
  for (const oi of orderInputs) {
    if (!oi.key) continue;
    const d = await getOrderData(oi.key);
    if (d) orders.push(d);
  }

  const starts: Date[] = [];
  const ends: Date[] = [];
  let totalHours = 0;
  let hasProduction = false;

  const bodyHasOrder = !!input.bodyOrder;
  const containerHasOrder = !!input.containerOrder;

  for (const o of orders) {
    if (o.start) starts.push(o.start);
    if (o.end) ends.push(o.end);
    totalHours += o.hours || 0;
    if (o.hours > 0 || o.start) hasProduction = true;
  }

  for (const j of found) {
    if (j.commeca === GENERIC_COMMESSA) continue;
    const isBody = input.jobBody && j.job === String(input.jobBody).trim();
    const isContainer = input.jobContainer && j.job === String(input.jobContainer).trim();
    if (isBody && bodyHasOrder) continue;
    if (isContainer && containerHasOrder) continue;
    if (j.productionStart) starts.push(j.productionStart);
    if (j.productionEnd) ends.push(j.productionEnd);
    totalHours += j.hours || 0;
    if (j.progressRows > 0) hasProduction = true;
  }

  const productionStart =
    starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
  const productionEnd =
    ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;

  return {
    found: found.length > 0,
    customer: primary?.customer ?? null,
    customerCountryIso: primary?.customerCountryIso ?? null,
    customerCountryName: primary?.customerCountryName ?? null,
    description: primary?.description ?? null,
    productionStart,
    productionEnd,
    totalHours: Math.round(totalHours * 100) / 100,
    hasProduction,
  };
}
