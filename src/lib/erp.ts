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
  erpSql?: typeof sql;
};

/**
 * Istanza UNICA del modulo mssql condivisa fra tutti i contesti (server API,
 * instrumentation/poller, ecc.). Necessaria perché con Turbopack/HMR il modulo
 * può essere caricato più volte: se il pool è creato da un'istanza e i tipi
 * (`SQL.Int`) vengono da un'altra, tedious lancia
 * "parameter.type.validate is not a function". Usare SEMPRE `SQL.*` a runtime.
 */
const SQL: typeof sql = (globalForErp.erpSql ??= sql);

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
    const pool = new SQL.ConnectionPool(config);
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
  /** Spedita = primo DDT (bolla) con righe di scopo SUPPLY sulla commessa. */
  shippedAt: Date | null;
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
    shippedAt: null,
    progressRows: 0,
    hours: 0,
  };
  if (commeca === null) return base;

  const pool = await getPool();

  const com = await pool
    .request()
    .input("c", SQL.Int, commeca)
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
      .input("conto", SQL.Int, c.co_conto)
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
            .input("c", SQL.Int, commeca)
            .query<{ n: number; min_s: Date | null; max_e: Date | null; ore: number | null }>(`
              SELECT COUNT(*) AS n, MIN(lce_start) AS min_s, MAX(lce_stop) AS max_e,
                     SUM(lce_tempese) AS ore
              FROM avlavp
              WHERE lce_commeca = @c;
            `)
        ).recordset[0];

  // Spedita: primo DDT (bolla, tm_tipork 'B') con righe di scopo SUPPLY
  // (movmag.mm_hhcodsc = '1', tabella tabhhsc) sulla commessa. I DDT successivi
  // sono completamenti di fornitura. La commessa generica 999999999 raccoglie
  // impianti diversi: nessuna data.
  const shippedAt =
    commeca === GENERIC_COMMESSA
      ? null
      : realDate(
          (
            await pool
              .request()
              .input("c", SQL.Int, commeca)
              .query<{ d: Date | null }>(`
                SELECT MIN(t.tm_datdoc) AS d
                FROM testmag t
                JOIN movmag m
                  ON m.codditt = t.codditt AND m.mm_tipork = t.tm_tipork AND m.mm_anno = t.tm_anno
                 AND m.mm_serie = t.tm_serie AND m.mm_numdoc = t.tm_numdoc
                WHERE t.codditt = 'ZATO' AND t.tm_tipork = 'B' AND m.mm_hhcodsc = '1'
                  AND t.tm_commeca = @c;
              `)
          ).recordset[0]?.d ?? null,
        );

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
    shippedAt,
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
    .input("c", SQL.Int, commeca)
    .input("lim", SQL.Int, limit)
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
  /** Data dell'ordine (anagrafica): utile quando non ci sono ancora ore. */
  orderDate: Date | null;
  /** Articolo con più ore, o la prima riga dell'ordine se non è ancora partito. */
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
/**
 * Elenco ordini di produzione (tipork 'H') di una commessa.
 *
 * Si parte dall'ANAGRAFICA ordini (`testord`): leggendo solo l'avanzamento
 * (`avlavp`) gli ordini su cui nessuno ha ancora timbrato non esistevano — sulla
 * commessa di stock 999999999 significava vederne 113 invece di 484, e un corpo
 * appena aperto non era selezionabile nel fascicolo. Ore, date e numero di
 * timbrature restano quelle di `avlavp` (0 se il lavoro non è ancora partito);
 * l'articolo principale è quello con più ore, oppure la prima riga dell'ordine
 * per chi non ha ancora avanzamento.
 */
export type ErpNaCustomerRow = {
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
};

/**
 * Clienti di ZATO North America. **Altro database, stessa istanza**: la ditta
 * ZATONA non esiste dentro `ZATO` (lì c'è solo codditt='ZATO'), sta in
 * `ZATONA.dbo.anagra`. Servono solo a compilare il cliente finale dei fascicoli
 * destinati agli USA, quindi si leggono tutti in un colpo (sono ~65).
 */
export async function getNaCustomers(): Promise<ErpNaCustomerRow[]> {
  const pool = await getPool();
  const res = await pool.request().query<{
    an_conto: string;
    an_descr1: string | null;
    an_indir: string | null;
    an_citta: string | null;
    an_prov: string | null;
    an_cap: string | null;
    an_stato: string | null;
  }>(
    `SELECT an_conto, an_descr1, an_indir, an_citta, an_prov, an_cap, an_stato
       FROM ZATONA.dbo.anagra
      WHERE an_tipo = 'C' AND LTRIM(RTRIM(ISNULL(an_descr1, ''))) <> ''
      ORDER BY an_descr1`
  );
  return res.recordset.map((x) => ({
    code: String(x.an_conto ?? "").trim(),
    name: (x.an_descr1 ?? "").trim(),
    address: (x.an_indir ?? "").trim() || null,
    city: (x.an_citta ?? "").trim() || null,
    state: (x.an_prov ?? "").trim() || null,
    zip: (x.an_cap ?? "").trim() || null,
    country: (x.an_stato ?? "").trim() || null,
  }));
}

export async function getCommessaOrders(commessa: string): Promise<ErpOrder[]> {
  const commeca = jobToCommeca(commessa);
  if (commeca === null) return [];
  const pool = await getPool();

  const r = await pool
    .request()
    .input("c", SQL.Int, commeca)
    .query<{
      anno: number;
      serie: string | null;
      num: number;
      datord: Date | null;
      n: number;
      ore: number | null;
      s: Date | null;
      e: Date | null;
      art_count: number;
      code: string | null;
      descr: string | null;
    }>(`
      WITH av AS (
        SELECT lce_oranno AS anno, LTRIM(RTRIM(lce_orserie)) AS serie, lce_ornum AS num,
               COUNT(*) AS n, SUM(lce_tempese) AS ore,
               MIN(lce_start) AS s, MAX(lce_stop) AS e,
               COUNT(DISTINCT lce_codart) AS art_count
        FROM avlavp WHERE lce_commeca = @c AND lce_ortipo = 'H'
        GROUP BY lce_oranno, LTRIM(RTRIM(lce_orserie)), lce_ornum
      ), avmain AS (
        SELECT anno, serie, num, code, descr FROM (
          SELECT lce_oranno AS anno, LTRIM(RTRIM(lce_orserie)) AS serie, lce_ornum AS num,
                 lce_codart AS code, lce_desart AS descr,
                 ROW_NUMBER() OVER (PARTITION BY lce_oranno, LTRIM(RTRIM(lce_orserie)), lce_ornum
                                    ORDER BY SUM(lce_tempese) DESC) AS rn
          FROM avlavp WHERE lce_commeca = @c AND lce_ortipo = 'H'
          GROUP BY lce_oranno, LTRIM(RTRIM(lce_orserie)), lce_ornum, lce_codart, lce_desart
        ) x WHERE rn = 1
      ), mo AS (
        SELECT anno, serie, num, code, descr FROM (
          SELECT mo_anno AS anno, LTRIM(RTRIM(mo_serie)) AS serie, mo_numord AS num,
                 mo_codart AS code, mo_descr AS descr,
                 ROW_NUMBER() OVER (PARTITION BY mo_anno, LTRIM(RTRIM(mo_serie)), mo_numord
                                    ORDER BY mo_riga) AS rn
          FROM movord mv
          WHERE mo_tipork = 'H' AND EXISTS (
            SELECT 1 FROM testord t WHERE t.td_tipork = 'H' AND t.td_commeca = @c
              AND t.td_anno = mv.mo_anno AND t.td_numord = mv.mo_numord
              AND LTRIM(RTRIM(t.td_serie)) = LTRIM(RTRIM(mv.mo_serie))
          )
        ) y WHERE rn = 1
      ), k AS (
        -- anagrafica + eventuali ordini che hanno timbrature su questa commessa
        -- pur avendo un'altra commessa in testata (succede: 5 su 484)
        SELECT anno, serie, num, MAX(datord) AS datord FROM (
          SELECT td_anno AS anno, LTRIM(RTRIM(td_serie)) AS serie, td_numord AS num, td_datord AS datord
          FROM testord WHERE td_tipork = 'H' AND td_commeca = @c
          UNION ALL
          SELECT anno, serie, num, NULL FROM av
        ) u GROUP BY anno, serie, num
      )
      SELECT k.anno, k.serie, k.num, k.datord,
             ISNULL(av.n, 0) AS n, ISNULL(av.ore, 0) AS ore, av.s, av.e,
             ISNULL(av.art_count, 0) AS art_count,
             COALESCE(avmain.code, mo.code) AS code,
             COALESCE(avmain.descr, mo.descr) AS descr
      FROM k
      LEFT JOIN av ON av.anno = k.anno AND av.serie = k.serie AND av.num = k.num
      LEFT JOIN avmain ON avmain.anno = k.anno AND avmain.serie = k.serie AND avmain.num = k.num
      LEFT JOIN mo ON mo.anno = k.anno AND mo.serie = k.serie AND mo.num = k.num
      ORDER BY k.anno DESC, k.num DESC;
    `);

  return r.recordset.map((o) => {
    const serie = (o.serie ?? "").trim();
    return {
      key: buildOrderKey("H", o.anno, serie, o.num),
      tipork: "H",
      anno: o.anno,
      serie,
      num: o.num,
      orderDate: realDate(o.datord),
      mainArticleCode: o.code?.trim() || null,
      mainArticleDesc: o.descr?.trim() || null,
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

/** Chi ha timbrato su un ordine (lce_codcope: a volte una persona, a volte una postazione). */
export type ErpOrderOperator = {
  name: string;
  hours: number;
  rows: number;
  start: Date | null;
  end: Date | null;
  center: string | null;
};

/** Singola timbratura di avanzamento su un ordine. */
export type ErpOrderEntry = {
  operator: string | null;
  center: string | null;
  work: string | null;
  start: Date | null;
  end: Date | null;
  hours: number;
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
  operators: ErpOrderOperator[];
  entries: ErpOrderEntry[];
};

/** Dati di produzione di uno specifico ordine (ore, date, articoli). */
export async function getOrderData(orderKey: string): Promise<ErpOrderData | null> {
  const k = parseOrderKey(orderKey);
  if (!k) return null;
  const pool = await getPool();

  const agg = await pool
    .request()
    .input("t", SQL.VarChar, k.tipork)
    .input("y", SQL.Int, k.anno)
    .input("s", SQL.VarChar, k.serie)
    .input("n", SQL.Int, k.num)
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
      hours: 0, start: null, end: null, articles: [], operators: [], entries: [],
    };
  }

  const arts = await pool
    .request()
    .input("t", SQL.VarChar, k.tipork)
    .input("y", SQL.Int, k.anno)
    .input("s", SQL.VarChar, k.serie)
    .input("n", SQL.Int, k.num)
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

  // Chi ha timbrato (lce_codcope) e le singole timbrature: alimentano il
  // riquadro "timbrature per operatore" aperto dalla card Analisi ore.
  const ops = await pool
    .request()
    .input("t", SQL.VarChar, k.tipork)
    .input("y", SQL.Int, k.anno)
    .input("s", SQL.VarChar, k.serie)
    .input("n", SQL.Int, k.num)
    .query<{ nome: string | null; ore: number | null; n: number; s: Date | null; e: Date | null; centro: string | null }>(`
      SELECT MAX(lce_descope) AS nome, SUM(lce_tempese) AS ore, COUNT(*) AS n,
             MIN(lce_start) AS s, MAX(lce_stop) AS e, MAX(lce_descent) AS centro
      FROM avlavp
      WHERE lce_ortipo = @t AND lce_oranno = @y
        AND LTRIM(RTRIM(lce_orserie)) = @s AND lce_ornum = @n
      GROUP BY lce_codcope
      ORDER BY SUM(lce_tempese) DESC;
    `);

  const ent = await pool
    .request()
    .input("t", SQL.VarChar, k.tipork)
    .input("y", SQL.Int, k.anno)
    .input("s", SQL.VarChar, k.serie)
    .input("n", SQL.Int, k.num)
    .query<{ nome: string | null; centro: string | null; lavoro: string | null; s: Date | null; e: Date | null; ore: number | null }>(`
      SELECT TOP 300 lce_descope AS nome, lce_descent AS centro, lce_deslavo AS lavoro,
             lce_start AS s, lce_stop AS e, lce_tempese AS ore
      FROM avlavp
      WHERE lce_ortipo = @t AND lce_oranno = @y
        AND LTRIM(RTRIM(lce_orserie)) = @s AND lce_ornum = @n
      ORDER BY lce_start;
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
    operators: ops.recordset.map((x) => ({
      name: x.nome?.trim() || "—",
      hours: x.ore ?? 0,
      rows: x.n ?? 0,
      start: x.s ?? null,
      end: x.e ?? null,
      center: x.centro?.trim() || null,
    })),
    entries: ent.recordset.map((x) => ({
      operator: x.nome?.trim() || null,
      center: x.centro?.trim() || null,
      work: x.lavoro?.trim() || null,
      start: x.s ?? null,
      end: x.e ?? null,
      hours: x.ore ?? 0,
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
    .input("q", SQL.VarChar, `%${term}%`)
    .input("lim", SQL.Int, limit)
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

export type ErpArticle = { code: string; description: string };

/** Ricerca articoli/ricambi nel gestionale (tabella artico) per codice o descrizione. */
export async function searchErpArticles(q: string, limit = 20): Promise<ErpArticle[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const pool = await getPool();
  const r = await pool
    .request()
    .input("q", SQL.VarChar, `%${term}%`)
    .input("lim", SQL.Int, limit)
    .query<{ ar_codart: string | null; ar_descr: string | null }>(`
      SELECT TOP (@lim) ar_codart, ar_descr
      FROM artico
      WHERE codditt = 'ZATO' AND (ar_codart LIKE @q OR ar_descr LIKE @q)
      ORDER BY ar_codart ASC;
    `);
  return r.recordset.map((x) => ({
    code: (x.ar_codart ?? "").trim(),
    description: (x.ar_descr ?? "").trim(),
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
      .input("conto", SQL.Int, conto)
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
    .input("c", SQL.Int, commeca)
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
  /** Spedita: primo DDT SUPPLY della commessa di vendita (job principale). */
  shippedAt: Date | null;
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

  // Spedita: solo dalla commessa di vendita (job principale)
  const saleJob = norm.job ? String(norm.job).trim() : "";
  const shippedAt = found.find((j) => j.job === saleJob)?.shippedAt ?? null;

  return {
    jobs,
    orders,
    customer: primary?.customer ?? null,
    customerCountryIso: primary?.customerCountryIso ?? null,
    customerCountryName: primary?.customerCountryName ?? null,
    description: primary?.description ?? null,
    productionStart,
    productionEnd,
    shippedAt,
    totalHours: Math.round(totalHours * 100) / 100,
    hasProduction,
  };
}
