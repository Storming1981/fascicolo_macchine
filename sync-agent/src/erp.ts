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
  customerConto: number | null;
  customerCountryIso: string | null;
  customerCountryName: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  isClosed: boolean;
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
    customerConto: null,
    customerCountryIso: null,
    customerCountryName: null,
    openedAt: null,
    closedAt: null,
    isClosed: false,
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
      co_dtaper: Date | null;
      co_dtchiu: Date | null;
      co_chiusa: string | null;
    }>(`
      SELECT TOP 1 co_conto, co_descr1, co_dtaper, co_dtchiu, co_chiusa
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
    customerConto: c.co_conto && c.co_conto !== 0 ? c.co_conto : null,
    customerCountryIso,
    customerCountryName,
    openedAt: realDate(c.co_dtaper),
    closedAt: realDate(c.co_dtchiu),
    isClosed: c.co_chiusa === 'S',
    productionStart: realDate(a.min_s),
    productionEnd: realDate(a.max_e),
    progressRows: a.n ?? 0,
    hours: a.ore ?? 0,
  };
}

// ── Ordini di produzione (impianti nuovi: commessa 999999999) ───────────────

export function buildOrderKey(tipork: string, anno: number, serie: string, num: number): string {
  return `${tipork}|${anno}|${(serie ?? '').trim()}|${num}`;
}

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

export interface ErpOrderArticle {
  code: string | null;
  desc: string | null;
  hours: number;
  rows: number;
  start: Date | null;
  end: Date | null;
}

export interface ErpOrderData {
  key: string;
  found: boolean;
  tipork: string;
  anno: number;
  serie: string;
  num: number;
  hours: number;
  start: Date | null;
  end: Date | null;
  articles: ErpOrderArticle[];
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
  const baseOut: ErpOrderData = {
    key: orderKey, found: false,
    tipork: k.tipork, anno: k.anno, serie: k.serie, num: k.num,
    hours: 0, start: null, end: null, articles: [],
  };
  if (!a || (a.n ?? 0) === 0) return baseOut;

  const arts = await pool
    .request()
    .input('t', sql.VarChar, k.tipork)
    .input('y', sql.Int, k.anno)
    .input('s', sql.VarChar, k.serie)
    .input('n', sql.Int, k.num)
    .query<{
      lce_codart: string | null;
      lce_desart: string | null;
      ore: number | null;
      n: number;
      s: Date | null;
      e: Date | null;
    }>(`
      SELECT lce_codart, MIN(lce_desart) AS lce_desart,
        SUM(lce_tempese) AS ore, COUNT(*) AS n, MIN(lce_start) AS s, MAX(lce_stop) AS e
      FROM avlavp
      WHERE lce_ortipo = @t AND lce_oranno = @y
        AND LTRIM(RTRIM(lce_orserie)) = @s AND lce_ornum = @n
      GROUP BY lce_codart
      ORDER BY SUM(lce_tempese) DESC;
    `);

  return {
    ...baseOut,
    found: true,
    hours: a.ore ?? 0,
    start: realDate(a.s),
    end: realDate(a.e),
    articles: arts.recordset.map((x) => ({
      code: x.lce_codart?.trim() || null,
      desc: x.lce_desart?.trim() || null,
      hours: x.ore ?? 0,
      rows: x.n ?? 0,
      start: realDate(x.s),
      end: realDate(x.e),
    })),
  };
}

export interface ErpOrder {
  key: string;
  tipork: string;
  anno: number;
  serie: string;
  num: number;
  mainArticleCode: string | null;
  mainArticleDesc: string | null;
  hours: number;
  start: Date | null;
  end: Date | null;
  rows: number;
  articleCount: number;
}

/** Elenco ordini di produzione (tipork 'H') di una commessa (da avlavp). */
export async function getCommessaOrders(commessa: number): Promise<ErpOrder[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('c', sql.Int, commessa)
    .query<{
      lce_ortipo: string;
      lce_oranno: number;
      lce_orserie: string | null;
      lce_ornum: number;
      n: number;
      ore: number | null;
      s: Date | null;
      e: Date | null;
      art_count: number;
    }>(`
      SELECT lce_ortipo, lce_oranno, lce_orserie, lce_ornum,
        COUNT(*) AS n, SUM(lce_tempese) AS ore,
        MIN(lce_start) AS s, MAX(lce_stop) AS e,
        COUNT(DISTINCT lce_codart) AS art_count
      FROM avlavp
      WHERE lce_commeca = @c AND lce_ortipo = 'H'
      GROUP BY lce_ortipo, lce_oranno, lce_orserie, lce_ornum
      ORDER BY lce_oranno DESC, lce_ornum DESC;
    `);

  const mains = await pool
    .request()
    .input('c', sql.Int, commessa)
    .query<{
      lce_ortipo: string;
      lce_oranno: number;
      lce_orserie: string | null;
      lce_ornum: number;
      lce_codart: string | null;
      lce_desart: string | null;
    }>(`
      WITH x AS (
        SELECT lce_ortipo, lce_oranno, lce_orserie, lce_ornum, lce_codart, lce_desart,
          ROW_NUMBER() OVER (
            PARTITION BY lce_ortipo, lce_oranno, lce_orserie, lce_ornum
            ORDER BY SUM(lce_tempese) DESC
          ) AS rn
        FROM avlavp
        WHERE lce_commeca = @c AND lce_ortipo = 'H'
        GROUP BY lce_ortipo, lce_oranno, lce_orserie, lce_ornum, lce_codart, lce_desart
      )
      SELECT lce_ortipo, lce_oranno, lce_orserie, lce_ornum, lce_codart, lce_desart
      FROM x WHERE rn = 1;
    `);

  const mainBy = new Map<string, { code: string | null; desc: string | null }>();
  for (const m of mains.recordset) {
    const key = buildOrderKey(m.lce_ortipo, m.lce_oranno, m.lce_orserie ?? '', m.lce_ornum);
    mainBy.set(key, { code: m.lce_codart?.trim() || null, desc: m.lce_desart?.trim() || null });
  }

  return r.recordset.map((o) => {
    const serie = (o.lce_orserie ?? '').trim();
    const key = buildOrderKey(o.lce_ortipo, o.lce_oranno, serie, o.lce_ornum);
    const main = mainBy.get(key);
    return {
      key,
      tipork: o.lce_ortipo,
      anno: o.lce_oranno,
      serie,
      num: o.lce_ornum,
      mainArticleCode: main?.code ?? null,
      mainArticleDesc: main?.desc ?? null,
      hours: o.ore ?? 0,
      start: realDate(o.s),
      end: realDate(o.e),
      rows: o.n ?? 0,
      articleCount: o.art_count ?? 0,
    };
  });
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
  jobs: ErpJobData[];
  orders: { role: string; data: ErpOrderData }[];
  found: boolean;
  customer: string | null;
  customerConto: number | null;
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
  const orderInputs: { role: string; key: string | null | undefined }[] = [
    { role: 'Corpo', key: input.bodyOrder },
    { role: 'Container', key: input.containerOrder },
    { role: 'Cavalletto', key: input.standOrder },
    { role: 'Lame', key: input.bladesOrder },
  ];
  const orders: { role: string; data: ErpOrderData }[] = [];
  for (const oi of orderInputs) {
    if (!oi.key) continue;
    const d = await getOrderData(oi.key);
    if (d) orders.push({ role: oi.role, data: d });
  }

  const starts: Date[] = [];
  const ends: Date[] = [];
  let totalHours = 0;
  let hasProduction = false;

  const bodyHasOrder = !!input.bodyOrder;
  const containerHasOrder = !!input.containerOrder;

  for (const o of orders) {
    if (o.data.start) starts.push(o.data.start);
    if (o.data.end) ends.push(o.data.end);
    totalHours += o.data.hours || 0;
    if (o.data.hours > 0 || o.data.start) hasProduction = true;
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
    jobs,
    orders,
    found: found.length > 0,
    customer: primary?.customer ?? null,
    customerConto: primary?.customerConto ?? null,
    customerCountryIso: primary?.customerCountryIso ?? null,
    customerCountryName: primary?.customerCountryName ?? null,
    description: primary?.description ?? null,
    productionStart,
    productionEnd,
    totalHours: Math.round(totalHours * 100) / 100,
    hasProduction,
  };
}

// ── Anagrafica clienti (per i conti che ci servono) ─────────────────────────

export interface ErpCustomerDetail {
  conto: number;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  countryIso: string | null;
  countryName: string | null;
}

/** Intera anagrafica clienti (anagra, an_tipo='C') con nome non vuoto. */
export async function getAllCustomers(): Promise<ErpCustomerDetail[]> {
  const pool = await getPool();
  const r = await pool.request().query<{
    an_conto: number;
    an_descr1: string | null;
    an_address: string | null;
    an_citta: string | null;
    an_prov: string | null;
    iso2: string | null;
    country_name: string | null;
  }>(`
    SELECT a.an_conto, a.an_descr1, a.an_indir AS an_address, a.an_citta, a.an_prov,
           s.tb_siglaiso AS iso2, s.tb_desstat AS country_name
    FROM anagra a
    LEFT JOIN tabstat s ON s.tb_codstat = a.an_stato
    WHERE a.an_tipo = 'C' AND a.an_conto IS NOT NULL
      AND a.an_descr1 IS NOT NULL AND LTRIM(RTRIM(a.an_descr1)) <> ''
    ORDER BY a.an_descr1 ASC;
  `);
  return r.recordset.map((x) => ({
    conto: x.an_conto,
    name: (x.an_descr1 ?? '').trim(),
    address: x.an_address?.trim() || null,
    city: x.an_citta?.trim() || null,
    province: x.an_prov?.trim() || null,
    countryIso: x.iso2?.trim() || null,
    countryName: x.country_name?.trim() || null,
  }));
}

/**
 * Dettaglio anagrafica (anagra, an_tipo='C') per un elenco di conti clienti.
 * Interroga solo i conti che servono (quelli dei fascicoli), non tutta l'anagra.
 */
export async function getCustomerDetails(contos: number[]): Promise<ErpCustomerDetail[]> {
  const ids = Array.from(new Set(contos.filter((c) => Number.isFinite(c) && c > 0)));
  if (ids.length === 0) return [];
  const pool = await getPool();
  const out: ErpCustomerDetail[] = [];
  // a blocchi, per non fare un IN gigante
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const req = pool.request();
    const params = slice.map((v, k) => {
      req.input(`c${k}`, sql.Int, v);
      return `@c${k}`;
    });
    const r = await req.query<{
      an_conto: number;
      an_descr1: string | null;
      an_address: string | null;
      an_citta: string | null;
      an_prov: string | null;
      iso2: string | null;
      country_name: string | null;
    }>(`
      SELECT a.an_conto, a.an_descr1, a.an_indir AS an_address, a.an_citta, a.an_prov,
             s.tb_siglaiso AS iso2, s.tb_desstat AS country_name
      FROM anagra a
      LEFT JOIN tabstat s ON s.tb_codstat = a.an_stato
      WHERE a.an_tipo = 'C' AND a.an_conto IN (${params.join(',')});
    `);
    for (const x of r.recordset) {
      out.push({
        conto: x.an_conto,
        name: (x.an_descr1 ?? '').trim(),
        address: x.an_address?.trim() || null,
        city: x.an_citta?.trim() || null,
        province: x.an_prov?.trim() || null,
        countryIso: x.iso2?.trim() || null,
        countryName: x.country_name?.trim() || null,
      });
    }
  }
  return out;
}
