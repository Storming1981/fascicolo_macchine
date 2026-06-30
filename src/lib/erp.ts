import sql from "mssql";

/**
 * Integrazione READ-ONLY con il gestionale ZATO (SQL Server, Zucchetti AdHoc).
 *
 * Mappatura (vedi scripts/erp-*.ts per l'esplorazione):
 *  - Job Number del fascicolo  ==  commess.co_comme (intero)
 *  - Cliente                    = anagra.an_descr1  via commess.co_conto = anagra.an_conto
 *  - Apertura/chiusura commessa = commess.co_dtaper / co_dtchiu (+ flag co_chiusa)
 *  - Inizio produzione          = MIN(avlavp.lce_start)  WHERE lce_commeca = job
 *  - Fine produzione            = MAX(avlavp.lce_stop)   WHERE lce_commeca = job
 *
 * Tutte le query sono in sola lettura. Il pool è un singleton (riuso in dev).
 */

const config: sql.config = {
  server: process.env.SQLSERVER_HOST ?? "",
  port: Number(process.env.SQLSERVER_PORT ?? 1433),
  user: process.env.SQLSERVER_USER ?? "",
  password: process.env.SQLSERVER_PASSWORD ?? "",
  database: process.env.SQLSERVER_DATABASE ?? "ZATO",
  options: {
    encrypt: process.env.SQLSERVER_ENCRYPT === "true",
    trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "false",
    enableArithAbort: true,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  requestTimeout: 30_000,
  connectionTimeout: 10_000,
};

const globalForErp = globalThis as unknown as {
  erpPool?: Promise<sql.ConnectionPool>;
};

/** Commessa "generica" usata dal gestionale per gli impianti nuovi. */
export const GENERIC_COMMESSA = 999999999;

export function isErpConfigured(): boolean {
  return Boolean(process.env.SQLSERVER_HOST && process.env.SQLSERVER_USER);
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (!isErpConfigured()) {
    throw new Error("Gestionale non configurato (variabili SQLSERVER_* mancanti)");
  }
  if (!globalForErp.erpPool) {
    const pool = new sql.ConnectionPool(config);
    // Se la connessione fallisce, azzera il singleton per ritentare al prossimo giro
    pool.on("error", () => {
      globalForErp.erpPool = undefined;
    });
    globalForErp.erpPool = pool.connect().catch((err) => {
      globalForErp.erpPool = undefined;
      throw err;
    });
  }
  return globalForErp.erpPool;
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

export type ErpJobData = {
  job: string;
  commeca: number;
  found: boolean;
  /** Descrizione commessa (es. "BLUE DEVIL GF4000RII E #014"). */
  description: string | null;
  customer: string | null;
  /** Codice ISO2 del paese cliente (da tabstat.tb_siglaiso), se disponibile. */
  customerCountryIso: string | null;
  /** Nome del paese cliente in italiano (da tabstat.tb_desstat). */
  customerCountryName: string | null;
  /** Apertura commessa (data ordine/inizio commessa). */
  openedAt: Date | null;
  /** Chiusura commessa, null se ancora aperta (sentinella 2099). */
  closedAt: Date | null;
  isClosed: boolean;
  /** Inizio produzione = prima timbratura (MIN lce_start). */
  productionStart: Date | null;
  /** Fine produzione = ultima timbratura (MAX lce_stop). */
  productionEnd: Date | null;
  /** Numero di righe di avanzamento (timbrature) registrate. */
  progressRows: number;
  /** Ore di lavorazione totali eseguite (SUM lce_tempese). */
  hours: number;
};

/**
 * Dati di una singola commessa/job dal gestionale.
 * Restituisce `found:false` se la commessa non esiste.
 */
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
    .input("c", sql.Int, commeca)
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

  // Cliente + paese (an_stato è il codice targa; tabstat lo mappa a ISO2/nome)
  let customer: string | null = null;
  let customerCountryIso: string | null = null;
  let customerCountryName: string | null = null;
  if (c.co_conto && c.co_conto !== 0) {
    const cli = await pool
      .request()
      .input("conto", sql.Int, c.co_conto)
      .query<{
        an_descr1: string | null;
        iso2: string | null;
        country_name: string | null;
      }>(`
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

  // Avanzamento produzione.
  // La commessa generica 999999999 raccoglie TUTTI gli impianti nuovi: il suo
  // aggregato non è significativo (serve l'ordine), quindi non lo calcoliamo.
  const a =
    commeca === GENERIC_COMMESSA
      ? { n: 0, min_s: null, max_e: null, ore: 0 }
      : (
          await pool
            .request()
            .input("c", sql.Int, commeca)
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
    openedAt: realDate(c.co_dtaper),
    closedAt: realDate(c.co_dtchiu),
    isClosed: c.co_chiusa === "S",
    productionStart: a.min_s ?? null,
    productionEnd: a.max_e ?? null,
    progressRows: a.n ?? 0,
    hours: a.ore ?? 0,
  };
}

export type ErpFaseRow = {
  articolo: string | null;
  lavorazione: string | null;
  centro: string | null;
  start: Date | null;
  stop: Date | null;
  finale: boolean;
};

/** Dettaglio fasi/timbrature di una commessa (per eventuale visualizzazione). */
export async function getJobFasi(job: string, limit = 200): Promise<ErpFaseRow[]> {
  const commeca = jobToCommeca(job);
  if (commeca === null) return [];
  const pool = await getPool();
  const r = await pool
    .request()
    .input("c", sql.Int, commeca)
    .input("lim", sql.Int, limit)
    .query<{
      lce_desart: string | null;
      lce_deslavo: string | null;
      lce_descent: string | null;
      lce_start: Date | null;
      lce_stop: Date | null;
      lce_flfinale: string | null;
    }>(`
      SELECT TOP (@lim)
        lce_desart, lce_deslavo, lce_descent, lce_start, lce_stop, lce_flfinale
      FROM avlavp
      WHERE lce_commeca = @c
      ORDER BY lce_start ASC;
    `);
  return r.recordset.map((x) => ({
    articolo: x.lce_desart?.trim() || null,
    lavorazione: x.lce_deslavo?.trim() || null,
    centro: x.lce_descent?.trim() || null,
    start: x.lce_start ?? null,
    stop: x.lce_stop ?? null,
    finale: x.lce_flfinale === "S",
  }));
}

/* ── Ordini di produzione (per impianti nuovi: commessa 999999999) ──────── */

/** Chiave univoca ordine di produzione: "tipork|anno|serie|numero". */
export function buildOrderKey(
  tipork: string,
  anno: number,
  serie: string,
  num: number,
): string {
  return `${tipork}|${anno}|${(serie ?? "").trim()}|${num}`;
}

export function parseOrderKey(
  key: string,
): { tipork: string; anno: number; serie: string; num: number } | null {
  const parts = String(key).split("|");
  if (parts.length !== 4) return null;
  const anno = Number(parts[1]);
  const num = Number(parts[3]);
  if (!parts[0] || !Number.isFinite(anno) || !Number.isFinite(num)) return null;
  return { tipork: parts[0], anno, serie: parts[2] ?? "", num };
}

export type ErpOrder = {
  key: string;
  tipork: string;
  anno: number;
  serie: string;
  num: number;
  /** Articolo con più ore (rappresenta il pezzo prodotto). */
  mainArticleCode: string | null;
  mainArticleDesc: string | null;
  hours: number;
  start: Date | null;
  end: Date | null;
  rows: number;
  articleCount: number;
};

/**
 * Elenco degli ordini di produzione (tipork 'H') di una commessa, ricavati
 * dalle timbrature in avlavp. La tendina del fascicolo usa questa lista.
 */
export async function getCommessaOrders(commessa: string): Promise<ErpOrder[]> {
  const commeca = jobToCommeca(commessa);
  if (commeca === null) return [];
  const pool = await getPool();

  const r = await pool
    .request()
    .input("c", sql.Int, commeca)
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
      SELECT
        lce_ortipo, lce_oranno, lce_orserie, lce_ornum,
        COUNT(*) AS n, SUM(lce_tempese) AS ore,
        MIN(lce_start) AS s, MAX(lce_stop) AS e,
        COUNT(DISTINCT lce_codart) AS art_count
      FROM avlavp
      WHERE lce_commeca = @c AND lce_ortipo = 'H'
      GROUP BY lce_ortipo, lce_oranno, lce_orserie, lce_ornum
      ORDER BY lce_oranno DESC, lce_ornum DESC;
    `);

  // Articolo principale (max ore) per ciascun ordine
  const mains = await pool
    .request()
    .input("c", sql.Int, commeca)
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
    const key = buildOrderKey(m.lce_ortipo, m.lce_oranno, m.lce_orserie ?? "", m.lce_ornum);
    mainBy.set(key, { code: m.lce_codart?.trim() || null, desc: m.lce_desart?.trim() || null });
  }

  return r.recordset.map((o) => {
    const serie = (o.lce_orserie ?? "").trim();
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
      start: o.s ?? null,
      end: o.e ?? null,
      rows: o.n ?? 0,
      articleCount: o.art_count ?? 0,
    };
  });
}

export type ErpOrderArticle = {
  code: string | null;
  desc: string | null;
  hours: number;
  rows: number;
  start: Date | null;
  end: Date | null;
};

export type ErpOrderData = {
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
};

/** Dati di produzione di uno specifico ordine (ore, date, articoli). */
export async function getOrderData(orderKey: string): Promise<ErpOrderData | null> {
  const k = parseOrderKey(orderKey);
  if (!k) return null;
  const pool = await getPool();

  const agg = await pool
    .request()
    .input("t", sql.VarChar, k.tipork)
    .input("y", sql.Int, k.anno)
    .input("s", sql.VarChar, k.serie)
    .input("n", sql.Int, k.num)
    .query<{ n: number; ore: number | null; s: Date | null; e: Date | null }>(`
      SELECT COUNT(*) AS n, SUM(lce_tempese) AS ore, MIN(lce_start) AS s, MAX(lce_stop) AS e
      FROM avlavp
      WHERE lce_ortipo = @t AND lce_oranno = @y
        AND LTRIM(RTRIM(lce_orserie)) = @s AND lce_ornum = @n;
    `);

  const a = agg.recordset[0];
  if (!a || (a.n ?? 0) === 0) {
    return {
      key: orderKey, found: false,
      tipork: k.tipork, anno: k.anno, serie: k.serie, num: k.num,
      hours: 0, start: null, end: null, articles: [],
    };
  }

  const arts = await pool
    .request()
    .input("t", sql.VarChar, k.tipork)
    .input("y", sql.Int, k.anno)
    .input("s", sql.VarChar, k.serie)
    .input("n", sql.Int, k.num)
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
    key: orderKey, found: true,
    tipork: k.tipork, anno: k.anno, serie: k.serie, num: k.num,
    hours: a.ore ?? 0,
    start: a.s ?? null,
    end: a.e ?? null,
    articles: arts.recordset.map((x) => ({
      code: x.lce_codart?.trim() || null,
      desc: x.lce_desart?.trim() || null,
      hours: x.ore ?? 0,
      rows: x.n ?? 0,
      start: x.s ?? null,
      end: x.e ?? null,
    })),
  };
}

export type ErpCustomer = {
  conto: number;
  name: string;
  countryIso: string | null;
  countryName: string | null;
  city: string | null;
};

/**
 * Ricerca clienti nell'anagrafica del gestionale (anagra, an_tipo='C') per
 * nome. Serve ad agganciare un Customer del modulo Service al conto ERP.
 */
export async function searchErpCustomers(q: string, limit = 20): Promise<ErpCustomer[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const pool = await getPool();
  const r = await pool
    .request()
    .input("q", sql.VarChar, `%${term}%`)
    .input("lim", sql.Int, limit)
    .query<{
      an_conto: number;
      an_descr1: string | null;
      an_citta: string | null;
      iso2: string | null;
      country_name: string | null;
    }>(`
      SELECT TOP (@lim)
        a.an_conto, a.an_descr1, a.an_citta,
        s.tb_siglaiso AS iso2, s.tb_desstat AS country_name
      FROM anagra a
      LEFT JOIN tabstat s ON s.tb_codstat = a.an_stato
      WHERE a.an_tipo = 'C' AND a.an_descr1 LIKE @q
      ORDER BY a.an_descr1 ASC;
    `);
  return r.recordset.map((x) => ({
    conto: x.an_conto,
    name: (x.an_descr1 ?? "").trim(),
    countryIso: x.iso2?.trim() || null,
    countryName: x.country_name?.trim() || null,
    city: x.an_citta?.trim() || null,
  }));
}

export type ErpCustomerDetail = {
  conto: number;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  cap: string | null;
  countryIso: string | null;
  countryName: string | null;
};

/**
 * Dettaglio anagrafica cliente (an_tipo='C') dal gestionale, per conto.
 * Tenta i campi indirizzo standard AdHoc; in caso di colonne assenti ricade
 * su un set minimo (nome + località + nazione).
 */
export async function getErpCustomerByConto(conto: number): Promise<ErpCustomerDetail | null> {
  const pool = await getPool();
  const run = async (cols: string) =>
    pool
      .request()
      .input("conto", sql.Int, conto)
      .query<Record<string, string | null>>(`
        SELECT TOP 1 ${cols}
        FROM anagra a
        LEFT JOIN tabstat s ON s.tb_codstat = a.an_stato
        WHERE a.an_conto = @conto AND a.an_tipo = 'C';
      `);

  let rec: Record<string, string | null> | undefined;
  try {
    const r = await run(
      "a.an_descr1, a.an_indir, a.an_citta, a.an_prov, a.an_cap, s.tb_siglaiso AS iso2, s.tb_desstat AS country_name"
    );
    rec = r.recordset[0];
  } catch {
    // fallback: solo colonne sicure
    const r = await run("a.an_descr1, a.an_citta, s.tb_siglaiso AS iso2, s.tb_desstat AS country_name");
    rec = r.recordset[0];
  }
  if (!rec) return null;
  const t = (v: string | null | undefined) => (v ?? "").toString().trim() || null;
  return {
    conto,
    name: t(rec.an_descr1) ?? "",
    address: t(rec.an_indir),
    city: t(rec.an_citta),
    province: t(rec.an_prov),
    cap: t(rec.an_cap),
    countryIso: t(rec.iso2),
    countryName: t(rec.country_name),
  };
}

/** Dettaglio cliente anagra a partire da un job (commessa di vendita). */
export async function getErpCustomerForJob(job: string): Promise<ErpCustomerDetail | null> {
  const commeca = jobToCommeca(job);
  if (commeca === null) return null;
  const pool = await getPool();
  const com = await pool
    .request()
    .input("c", sql.Int, commeca)
    .query<{ co_conto: number }>(`SELECT TOP 1 co_conto FROM commess WHERE co_comme = @c;`);
  const conto = com.recordset[0]?.co_conto;
  if (!conto) return null;
  return getErpCustomerByConto(conto);
}

export type ErpMachineData = {
  /** Dati per ogni job (job principale + body + container, deduplicati). */
  jobs: ErpJobData[];
  /** Cliente "primario" (dal primo job trovato = commessa di vendita). */
  customer: string | null;
  customerCountryIso: string | null;
  customerCountryName: string | null;
  /** Descrizione commessa primaria (co_descr1 del primo job trovato). */
  description: string | null;
  /** Ordini di produzione selezionati (corpo / container) con dati avlavp. */
  orders: { role: string; data: ErpOrderData }[];
  /** Inizio produzione aggregato. */
  productionStart: Date | null;
  /** Fine produzione aggregata. */
  productionEnd: Date | null;
  /** Ore di lavorazione totali. */
  totalHours: number;
  /** Almeno una fonte (commessa o ordine) ha avanzamenti tracciati. */
  hasProduction: boolean;
};

export type MachineErpInput = {
  job?: string | null;
  jobBody?: string | null;
  jobContainer?: string | null;
  /** Ordine di produzione selezionato per il corpo (chiave da buildOrderKey). */
  bodyOrder?: string | null;
  /** Ordine di produzione selezionato per il container. */
  containerOrder?: string | null;
  /** Ordine di produzione selezionato per il cavalletto. */
  standOrder?: string | null;
  /** Ordine di produzione selezionato per le lame. */
  bladesOrder?: string | null;
};

/**
 * Dati ERP aggregati per una macchina.
 *
 * - Cliente/paese/descrizione: dalla prima commessa trovata (di norma la
 *   commessa di vendita `job`).
 * - Produzione (ore/date): per ogni "parte" (vendita/corpo/container) usa
 *   l'ORDINE selezionato se presente, altrimenti il livello commessa.
 *   Per gli impianti nuovi (commessa 999999999) l'ordine è obbligatorio,
 *   altrimenti la commessa generica aggregherebbe macchine diverse.
 */
export async function getMachineErpData(
  input: MachineErpInput | (string | null | undefined)[],
): Promise<ErpMachineData> {
  // Retrocompatibilità: accetta ancora un array di job (solo commesse)
  const norm: MachineErpInput = Array.isArray(input)
    ? { job: input[0], jobBody: input[1], jobContainer: input[2] }
    : input;

  const GENERIC = GENERIC_COMMESSA; // commessa generica impianti nuovi

  const uniqJobs = Array.from(
    new Set(
      [norm.job, norm.jobBody, norm.jobContainer]
        .map((j) => (j ? String(j).trim() : ""))
        .filter((j) => jobToCommeca(j) !== null),
    ),
  );

  const jobs = await Promise.all(uniqJobs.map((j) => getJobData(j)));
  const found = jobs.filter((j) => j.found);
  // cliente "primario": prima commessa reale con cliente (esclude 999999999)
  const primary =
    found.find((j) => j.customer && j.commeca !== GENERIC) ?? found[0] ?? null;

  // Ordini selezionati (impianti nuovi: corpo, container, cavalletto, lame)
  const orders: { role: string; data: ErpOrderData }[] = [];
  const orderInputs: { role: string; key: string | null | undefined }[] = [
    { role: "Corpo", key: norm.bodyOrder },
    { role: "Container", key: norm.containerOrder },
    { role: "Cavalletto", key: norm.standOrder },
    { role: "Lame", key: norm.bladesOrder },
  ];
  for (const oi of orderInputs) {
    if (!oi.key) continue;
    const d = await getOrderData(oi.key);
    if (d) orders.push({ role: oi.role, data: d });
  }

  // Fonti di produzione: ordini selezionati (prevalgono) + commesse specifiche
  // (≠ 999999999) senza ordine. La commessa generica da sola NON è una fonte.
  const starts: Date[] = [];
  const ends: Date[] = [];
  let totalHours = 0;
  let hasProduction = false;

  const bodyHasOrder = !!norm.bodyOrder;
  const containerHasOrder = !!norm.containerOrder;

  // contributo ordini
  for (const o of orders) {
    if (o.data.start) starts.push(o.data.start);
    if (o.data.end) ends.push(o.data.end);
    totalHours += o.data.hours || 0;
    if (o.data.hours > 0 || o.data.start) hasProduction = true;
  }

  // contributo commesse specifiche (no ordine selezionato per quella parte)
  for (const j of found) {
    if (j.commeca === GENERIC) continue; // generica: serve l'ordine
    // se la parte corpo/container ha un ordine, evita doppio conteggio commessa
    const isBody = norm.jobBody && j.job === String(norm.jobBody).trim();
    const isContainer = norm.jobContainer && j.job === String(norm.jobContainer).trim();
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
