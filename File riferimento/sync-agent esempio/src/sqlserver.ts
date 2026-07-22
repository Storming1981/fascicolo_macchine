// Connessione e lettura dal gestionale (SQL Server, DB ZATO e ZATONA).
//
// Le query replicano (in forma semplificata) le query del gestionale viste nelle
// screenshot fornite dal cliente: aggregazione su dwarehe + join con anagra,
// artico, tabgmer, tabsgme, tabzone, tabcate, tabcana, tabhhdf, tabhhuf, tabhhsc,
// tabhhtp, tabhhtm, testord, movord, ecc. per fatturato e backlog.
//
// Differenze rispetto alle query originali del gestionale:
// - Non includiamo TUTTE le colonne dw_* (il dwarehe ne ha 200+), solo i campi
//   che ci servono per popolare i record Revenue/Backlog del dashboard.
// - Le query sono parametrizzate per `codditt` e `dw_scenario`, in modo che le
//   stesse SQL girino sia su DB ZATO che ZATONA.

import sql from 'mssql';
import { config, DbInstanceConfig } from './config';

// ============================================================
// Tipi di output delle query
// ============================================================

export interface RevenueRowRaw {
  numero_documento: number | null;
  serie: string | null;
  cliente: string | null;
  an_conto: number | null; // codice anagrafica cliente (per filtraggio)
  prodotto: string | null;
  zona_cliente: string | null;
  gruppo_prodotto: string | null;
  sottogruppo_prodotto: string | null;
  contropartita: number | null;
  commessa: number | null;
  categoria_cliente: string | null;
  canale_cliente: string | null;
  continente_destinazione: string | null;
  tipologia_utilizzatore: string | null;
  scopo_fornitura: string | null;
  tipologia_fornitura: string | null;
  modello_fornitura: string | null;
  tipo_record: string | null;
  tipo_bolla_fattura: number | null;
  data_documento: Date | null;
  mese: number;
  anno: number;
  quantita_fatturata: number | null;
  valore_fatturato: number | null;
  costo_totale_previsto: number | null;
  margine: number | null;
  provvigione_agente_1: number | null;
  provvigione_agente_2: number | null;
  margine_provvigione: number | null;
  costo_previsto: number | null;
  margine_consuntivo: number | null;
}

export interface BacklogRowRaw {
  serie_documento: string | null;
  numero_documento: string | null;
  cliente: string | null;
  an_conto: number | null;
  data_ordine: Date | null;
  data_consegna: Date | null;
  commessa: string | null;
  prodotto: string | null;
  gruppo_prodotto: string | null;
  sottogruppo_prodotto: string | null;
  contropartita: string | null;
  continente_destinazione: string | null;
  tipologia_utilizzatore: string | null;
  scopo_fornitura: string | null;
  tipologia_fornitura: string | null;
  modello_fornitura: string | null;
  tipo_record: string | null;
  tipo_bolla_fattura: number | null;
  quantita_da_evadere: number | null;
  valore_residuo: number | null;
  provvigione_agente_1: number | null;
}

// ============================================================
// Connection pool per database
// ============================================================

const pools = new Map<string, sql.ConnectionPool>();

async function getPoolFor(dbName: string): Promise<sql.ConnectionPool> {
  const existing = pools.get(dbName);
  if (existing) return existing;

  const cfg: sql.config = {
    server: config.sqlserver.server,
    port: config.sqlserver.port,
    user: config.sqlserver.user,
    password: config.sqlserver.password,
    database: dbName,
    options: config.sqlserver.options,
    pool: config.sqlserver.pool,
  };
  // IMPORTANTE: NON usiamo sql.connect(cfg) perche' usa un pool singleton
  // globale: la seconda chiamata con un DB diverso restituisce il primo pool
  // (configurato sul primo DB), facendo eseguire le query "ZATONA" sul DB
  // ZATO. Creiamo invece un ConnectionPool dedicato per ogni DB.
  const pool = new sql.ConnectionPool(cfg);
  await pool.connect();
  pools.set(dbName, pool);
  console.log(`  Connesso a SQL Server: ${cfg.server}:${cfg.port}/${dbName}`);
  return pool;
}

export async function closeAllPools(): Promise<void> {
  for (const [name, pool] of pools.entries()) {
    try {
      await pool.close();
    } catch (e) {
      console.error(`Errore chiudendo pool ${name}:`, e);
    }
  }
  pools.clear();
}

// ============================================================
// QUERY FATTURATO (revenues) per un anno
// ============================================================

// Le dimensioni continente/utilizzatore/scopo/tipologia/modello vengono da DUE
// percorsi, con COALESCE Ord -> Imm:
//   Ord = dwarehe -> movord -> testord (per le righe legate a un ordine)
//   Imm = dwarehe -> movmag -> testmag (per le fatture/DDT, che linkano al
//         movimento di magazzino, NON all'ordine)
// Senza il chain Imm le fatture mostrerebbero N/D su tutte le dimensioni.
const REVENUES_SQL = `
SELECT
  dwarehe.dw_numdoc                                  AS numero_documento,
  dwarehe.dw_serie                                   AS serie,
  CASE WHEN anagra.an_descr1 IS NULL THEN '***'
       ELSE LTRIM(RTRIM(REPLACE(anagra.an_descr1,'-','')))
  END                                                AS cliente,
  dwarehe.dw_conto                                   AS an_conto,
  CASE WHEN artico.ar_descr IS NULL THEN '***'
       ELSE LTRIM(RTRIM(CAST(dwarehe.dw_codart AS CHAR))) + ' - ' + artico.ar_descr
  END                                                AS prodotto,
  tabzone.tb_deszone                                 AS zona_cliente,
  tabgmer.tb_desgmer                                 AS gruppo_prodotto,
  tabsgme.tb_dessgme                                 AS sottogruppo_prodotto,
  dwarehe.dw_controp                                 AS contropartita,
  dwarehe.dw_commeca                                 AS commessa,
  tabcate.tb_descate                                 AS categoria_cliente,
  tabcana.tb_descana                                 AS canale_cliente,
  ISNULL(dfOrd.tb_deshhdf, ISNULL(dfImm.tb_deshhdf, dfEva.tb_deshhdf)) AS continente_destinazione,
  ISNULL(ufOrd.tb_deshhuf, ISNULL(ufImm.tb_deshhuf, ufEva.tb_deshhuf)) AS tipologia_utilizzatore,
  ISNULL(scOrd.tb_deshhsc, ISNULL(scImm.tb_deshhsc, scEva.tb_deshhsc)) AS scopo_fornitura,
  ISNULL(tpOrd.tb_deshhtp, ISNULL(tpImm.tb_deshhtp, tpEva.tb_deshhtp)) AS tipologia_fornitura,
  ISNULL(tmOrd.tb_deshhtm, ISNULL(tmImm.tb_deshhtm, tmEva.tb_deshhtm)) AS modello_fornitura,
  dwarehe.dw_tipork                                  AS tipo_record,
  dwarehe.dw_tipobf                                  AS tipo_bolla_fattura,
  -- Data del documento (fattura). MAX -> 1 valore per gruppo (uniforme per riga doc).
  CAST(MAX(dwarehe.dw_datmov) AS DATE)               AS data_documento,
  dwarehe.dw_mese                                    AS mese,
  dwarehe.dw_anno                                    AS anno,
  SUM(dwarehe.dw_quantfatt)                          AS quantita_fatturata,
  SUM(dwarehe.dw_valfatt)                            AS valore_fatturato,
  -- Costo totale previsto = costo unitario (cu) x quantita' fatturata.
  SUM(ISNULL(cu.costo_unit, 0) * dwarehe.dw_quantfatt)               AS costo_totale_previsto,
  SUM(dwarehe.dw_valfatt - ISNULL(cu.costo_unit, 0) * dwarehe.dw_quantfatt) AS margine,
  SUM(dwarehe.dw_vprovv)                             AS provvigione_agente_1,
  SUM(dwarehe.dw_vprovvf)                            AS provvigione_agente_2,
  SUM(dwarehe.dw_valfatt - ISNULL(cu.costo_unit, 0) * dwarehe.dw_quantfatt
      - dwarehe.dw_vprovv - dwarehe.dw_vprovvf)      AS margine_provvigione,
  SUM(ISNULL(cu.costo_unit, 0) * dwarehe.dw_quantfatt)               AS costo_previsto,
  SUM(dwarehe.dw_valfatt - ISNULL(cu.costo_unit, 0) * dwarehe.dw_quantfatt) AS margine_consuntivo
FROM dwarehe
LEFT JOIN anagra  ON dwarehe.codditt = anagra.codditt  AND dwarehe.dw_conto    = anagra.an_conto
LEFT JOIN artico  ON dwarehe.codditt = artico.codditt  AND dwarehe.dw_codart   = artico.ar_codart
LEFT JOIN tabzone ON anagra.codditt  = tabzone.codditt AND anagra.an_zona      = tabzone.tb_codzone
LEFT JOIN tabgmer ON artico.codditt  = tabgmer.codditt AND artico.ar_gruppo    = tabgmer.tb_codgmer
LEFT JOIN tabsgme ON artico.codditt  = tabsgme.codditt AND artico.ar_sotgru    = tabsgme.tb_codsgme
LEFT JOIN tabcate ON tabcate.codditt = anagra.codditt  AND tabcate.tb_codcate  = anagra.an_categ
LEFT JOIN tabcana ON tabcana.codditt = anagra.codditt  AND tabcana.tb_codcana  = anagra.an_codcana
-- Chain ORDINE (Ord): dwarehe -> movord -> testord
LEFT JOIN movord  ON dwarehe.codditt    = movord.codditt
                 AND dwarehe.dw_motipork = movord.mo_tipork
                 AND dwarehe.dw_moanno   = movord.mo_anno
                 AND dwarehe.dw_moserie  = movord.mo_serie
                 AND dwarehe.dw_monumord = movord.mo_numord
                 AND dwarehe.dw_moriga   = movord.mo_riga
LEFT JOIN testord ON movord.codditt   = testord.codditt
                 AND movord.mo_tipork  = testord.td_tipork
                 AND movord.mo_anno    = testord.td_anno
                 AND movord.mo_serie   = testord.td_serie
                 AND movord.mo_numord  = testord.td_numord
-- Chain MOVIMENTO IMMEDIATO (Imm): dwarehe -> movmag (mi) -> testmag (testimm)
-- E' il percorso che usano le fatture/DDT (linkano al movimento, non all'ordine)
LEFT JOIN movmag mi ON dwarehe.codditt    = mi.codditt
                   AND dwarehe.dw_tipork  = mi.mm_tipork
                   AND dwarehe.dw_anno    = mi.mm_anno
                   AND dwarehe.dw_serie   = mi.mm_serie
                   AND dwarehe.dw_numdoc  = mi.mm_numdoc
                   AND dwarehe.dw_riga    = mi.mm_riga
LEFT JOIN testmag testimm ON mi.codditt    = testimm.codditt
                         AND mi.mm_tipork  = testimm.tm_tipork
                         AND mi.mm_anno    = testimm.tm_anno
                         AND mi.mm_serie   = testimm.tm_serie
                         AND mi.mm_numdoc  = testimm.tm_numdoc
-- Chain EVASIONE (Eva): le fatture differite (D) non hanno movmag proprio ne'
-- link ordine diretto (dw_mo* vuoto); il riferimento al movimento d'origine
-- (ordine evaso) e' in dwarehe.dw_rmo*. Da li' recuperiamo la classificazione.
LEFT JOIN movord moEva ON dwarehe.codditt    = moEva.codditt
                      AND dwarehe.dw_rmotr   = moEva.mo_tipork
                      AND dwarehe.dw_rmoan   = moEva.mo_anno
                      AND dwarehe.dw_rmose   = moEva.mo_serie
                      AND dwarehe.dw_rmonum  = moEva.mo_numord
                      AND dwarehe.dw_rmoriga = moEva.mo_riga
LEFT JOIN testord toEva ON moEva.codditt   = toEva.codditt
                       AND moEva.mo_tipork = toEva.td_tipork
                       AND moEva.mo_anno   = toEva.td_anno
                       AND moEva.mo_serie  = toEva.td_serie
                       AND moEva.mo_numord = toEva.td_numord
-- tabhh: un alias per ogni chain (Ord da testord/movord, Imm da testmag/movmag, Eva da moEva/toEva)
LEFT JOIN tabhhdf dfOrd ON dfOrd.codditt = dwarehe.codditt AND dfOrd.tb_codhhdf = testord.td_hhcoddf
LEFT JOIN tabhhdf dfImm ON dfImm.codditt = dwarehe.codditt AND dfImm.tb_codhhdf = testimm.tm_hhcoddf
LEFT JOIN tabhhuf ufOrd ON ufOrd.codditt = dwarehe.codditt AND ufOrd.tb_codhhuf = testord.td_hhcoduf
LEFT JOIN tabhhuf ufImm ON ufImm.codditt = dwarehe.codditt AND ufImm.tb_codhhuf = testimm.tm_hhcoduf
LEFT JOIN tabhhsc scOrd ON scOrd.codditt = dwarehe.codditt AND scOrd.tb_codhhsc = movord.mo_hhcodsc
LEFT JOIN tabhhsc scImm ON scImm.codditt = dwarehe.codditt AND scImm.tb_codhhsc = mi.mm_hhcodsc
LEFT JOIN tabhhtp tpOrd ON tpOrd.codditt = dwarehe.codditt AND tpOrd.tb_codhhtp = movord.mo_hhcodtp
LEFT JOIN tabhhtp tpImm ON tpImm.codditt = dwarehe.codditt AND tpImm.tb_codhhtp = mi.mm_hhcodtp
LEFT JOIN tabhhtm tmOrd ON tmOrd.codditt = dwarehe.codditt AND tmOrd.tb_codhhtm = movord.mo_hhcodtm
LEFT JOIN tabhhtm tmImm ON tmImm.codditt = dwarehe.codditt AND tmImm.tb_codhhtm = mi.mm_hhcodtm
LEFT JOIN tabhhdf dfEva ON dfEva.codditt = dwarehe.codditt AND dfEva.tb_codhhdf = toEva.td_hhcoddf
LEFT JOIN tabhhuf ufEva ON ufEva.codditt = dwarehe.codditt AND ufEva.tb_codhhuf = toEva.td_hhcoduf
LEFT JOIN tabhhsc scEva ON scEva.codditt = dwarehe.codditt AND scEva.tb_codhhsc = moEva.mo_hhcodsc
LEFT JOIN tabhhtp tpEva ON tpEva.codditt = dwarehe.codditt AND tpEva.tb_codhhtp = moEva.mo_hhcodtp
LEFT JOIN tabhhtm tmEva ON tmEva.codditt = dwarehe.codditt AND tmEva.tb_codhhtm = moEva.mo_hhcodtm
-- COSTO previsto UNITARIO. Non sta in dwarehe (dw_costorel=0) ma in movmag.mm_hhcostoprev:
--   - fatture immediate/DDT (A/B): movmag proprio (mi).
--   - fatture differite (D): non hanno movmag proprio -> si recupera dal movmag del
--     DDT evaso, raggiunto tramite il riferimento ordine (dw_rmo* = movmag.mm_or*).
-- OUTER APPLY = max 1 valore per riga (niente moltiplicazione delle righe).
OUTER APPLY (
  SELECT ISNULL(
    mi.mm_hhcostoprev,
    (SELECT TOP 1 ddt.mm_hhcostoprev
       FROM movmag ddt
      WHERE ddt.codditt   = dwarehe.codditt
        AND ddt.mm_tipork = 'B'
        -- Solo se la riga ha un riferimento ordine valido: senza guardia, le righe
        -- con dw_rmo* vuoto (acconti/storni) matcherebbero TUTTI i DDT con ref vuoto.
        AND LTRIM(RTRIM(ISNULL(dwarehe.dw_rmotr, ''))) <> ''
        AND dwarehe.dw_rmonum <> 0
        AND ddt.mm_ortipo = dwarehe.dw_rmotr
        AND ddt.mm_oranno = dwarehe.dw_rmoan
        AND ddt.mm_orserie = dwarehe.dw_rmose
        AND ddt.mm_ornum  = dwarehe.dw_rmonum
        AND ddt.mm_orriga = dwarehe.dw_rmoriga)
  ) AS costo_unit
) cu
WHERE dwarehe.dw_scenario = @scenario
  AND dwarehe.codditt = @codditt
  AND dwarehe.dw_anno = @year
  AND dwarehe.dw_tipork IN (__TIPI_RECORD__)
  AND NOT (
    ISNULL(dwarehe.dw_quantfatt, 0) = 0 AND
    ISNULL(dwarehe.dw_valfatt,   0) = 0 AND
    ISNULL(dwarehe.dw_vprovv,    0) = 0 AND
    ISNULL(dwarehe.dw_vprovvf,   0) = 0
  )
GROUP BY
  dwarehe.dw_anno, dwarehe.dw_mese, dwarehe.dw_numdoc, dwarehe.dw_serie,
  dwarehe.dw_tipork, dwarehe.dw_tipobf,
  dwarehe.dw_conto, dwarehe.dw_codart, dwarehe.dw_controp, dwarehe.dw_commeca,
  anagra.an_descr1, artico.ar_descr,
  tabzone.tb_deszone, tabgmer.tb_desgmer, tabsgme.tb_dessgme,
  tabcate.tb_descate, tabcana.tb_descana,
  dfOrd.tb_deshhdf, dfImm.tb_deshhdf, dfEva.tb_deshhdf,
  ufOrd.tb_deshhuf, ufImm.tb_deshhuf, ufEva.tb_deshhuf,
  scOrd.tb_deshhsc, scImm.tb_deshhsc, scEva.tb_deshhsc,
  tpOrd.tb_deshhtp, tpImm.tb_deshhtp, tpEva.tb_deshhtp,
  tmOrd.tb_deshhtm, tmImm.tb_deshhtm, tmEva.tb_deshhtm
`;

export async function getRevenuesForYear(
  db: DbInstanceConfig,
  year: number
): Promise<RevenueRowRaw[]> {
  const pool = await getPoolFor(db.database);
  // Sostituiamo i tipi record nella WHERE (lista hardcoded da config: ['A','B','D','N']).
  // Sanitizziamo per evitare SQL injection: solo caratteri alfanumerici, max 3 char.
  const tipi = config.sync.revenuesTipiRecord
    .filter((t) => /^[A-Za-z0-9]{1,3}$/.test(t))
    .map((t) => `'${t.toUpperCase()}'`)
    .join(',');
  if (!tipi) {
    throw new Error(
      'REVENUES_TIPI_RECORD: nessun tipo record valido configurato (alfanumerico max 3 char)'
    );
  }
  const sqlText = REVENUES_SQL.replace('__TIPI_RECORD__', tipi);
  const result = await pool
    .request()
    .input('scenario', sql.Int, config.sync.revenuesScenario)
    .input('codditt', sql.VarChar, db.codditt)
    .input('year', sql.Int, year)
    .query(sqlText);
  return result.recordset;
}

// ============================================================
// QUERY BACKLOG (ordini da evadere)
// ============================================================

// Backlog: stesso chain hh -> movord/testord. Quasi tutti i record di backlog
// hanno un ordine collegato per definizione, quindi le 5 dimensioni saranno
// popolate.
const BACKLOG_SQL = `
SELECT
  dwarehe.dw_serie                                   AS serie_documento,
  CAST(dwarehe.dw_numdoc AS VARCHAR(50))             AS numero_documento,
  CASE WHEN anagra.an_descr1 IS NULL THEN '***'
       ELSE LTRIM(RTRIM(REPLACE(anagra.an_descr1,'-','')))
  END                                                AS cliente,
  dwarehe.dw_conto                                   AS an_conto,
  dwarehe.dw_datmov2                                 AS data_ordine,
  dwarehe.dw_datmov                                  AS data_consegna,
  CAST(dwarehe.dw_commeca AS VARCHAR(50))            AS commessa,
  CASE WHEN artico.ar_descr IS NULL THEN '***'
       ELSE LTRIM(RTRIM(CAST(dwarehe.dw_codart AS CHAR))) + ' - ' + artico.ar_descr
  END                                                AS prodotto,
  tabgmer.tb_desgmer                                 AS gruppo_prodotto,
  tabsgme.tb_dessgme                                 AS sottogruppo_prodotto,
  CAST(dwarehe.dw_controp AS VARCHAR(50))            AS contropartita,
  tabhhdf.tb_deshhdf                                 AS continente_destinazione,
  tabhhuf.tb_deshhuf                                 AS tipologia_utilizzatore,
  tabhhsc.tb_deshhsc                                 AS scopo_fornitura,
  tabhhtp.tb_deshhtp                                 AS tipologia_fornitura,
  tabhhtm.tb_deshhtm                                 AS modello_fornitura,
  dwarehe.dw_tipork                                  AS tipo_record,
  testord.td_tipobf                                  AS tipo_bolla_fattura,
  SUM(ISNULL(movord.mo_quant - movord.mo_quaeva, 0)) AS quantita_da_evadere,
  SUM(ISNULL(movord.mo_valore, 0))                   AS valore_residuo,
  SUM(dwarehe.dw_vprovvo)                            AS provvigione_agente_1
FROM dwarehe
LEFT JOIN movord  ON dwarehe.codditt = movord.codditt
                 AND dwarehe.dw_motipork = movord.mo_tipork
                 AND dwarehe.dw_moanno   = movord.mo_anno
                 AND dwarehe.dw_moserie  = movord.mo_serie
                 AND dwarehe.dw_monumord = movord.mo_numord
                 AND dwarehe.dw_moriga   = movord.mo_riga
LEFT JOIN testord ON movord.codditt   = testord.codditt
                 AND movord.mo_tipork = testord.td_tipork
                 AND movord.mo_anno   = testord.td_anno
                 AND movord.mo_serie  = testord.td_serie
                 AND movord.mo_numord = testord.td_numord
LEFT JOIN anagra  ON dwarehe.codditt = anagra.codditt  AND dwarehe.dw_conto    = anagra.an_conto
LEFT JOIN artico  ON dwarehe.codditt = artico.codditt  AND dwarehe.dw_codart   = artico.ar_codart
LEFT JOIN tabgmer ON artico.codditt  = tabgmer.codditt AND artico.ar_gruppo    = tabgmer.tb_codgmer
LEFT JOIN tabsgme ON artico.codditt  = tabsgme.codditt AND artico.ar_sotgru    = tabsgme.tb_codsgme
LEFT JOIN tabhhdf ON tabhhdf.codditt = dwarehe.codditt AND tabhhdf.tb_codhhdf = testord.td_hhcoddf
LEFT JOIN tabhhuf ON tabhhuf.codditt = dwarehe.codditt AND tabhhuf.tb_codhhuf = testord.td_hhcoduf
LEFT JOIN tabhhsc ON tabhhsc.codditt = dwarehe.codditt AND tabhhsc.tb_codhhsc = movord.mo_hhcodsc
LEFT JOIN tabhhtp ON tabhhtp.codditt = dwarehe.codditt AND tabhhtp.tb_codhhtp = movord.mo_hhcodtp
LEFT JOIN tabhhtm ON tabhhtm.codditt = dwarehe.codditt AND tabhhtm.tb_codhhtm = movord.mo_hhcodtm
WHERE dwarehe.dw_scenario = @scenario
  AND dwarehe.codditt = @codditt
  AND dwarehe.dw_tipork IN (__TIPI_RECORD__)
  __TIPI_BF_CLAUSE__
  AND ISNULL(movord.mo_flevas, 'C') IN (__FLEVAS__)
  AND (
    -- Almeno uno tra valore residuo o quantita' da evadere deve essere non-zero.
    -- NON usiamo dw_vprovvo perche' resta valorizzato anche per ordini totalmente
    -- evasi (e' la provvigione storica calcolata all'ordine).
    ISNULL(movord.mo_valore, 0) <> 0
    OR ISNULL(movord.mo_quant - movord.mo_quaeva, 0) <> 0
  )
  AND ISNULL(testord.td_sospeso, 'N') <> 'S'
  AND dwarehe.dw_datmov BETWEEN @fromDate AND '2099-12-31'
GROUP BY
  dwarehe.dw_serie, dwarehe.dw_numdoc, dwarehe.dw_conto, dwarehe.dw_codart,
  dwarehe.dw_tipork, testord.td_tipobf,
  dwarehe.dw_controp, dwarehe.dw_commeca, dwarehe.dw_datmov, dwarehe.dw_datmov2,
  anagra.an_descr1, artico.ar_descr,
  tabgmer.tb_desgmer, tabsgme.tb_dessgme,
  tabhhdf.tb_deshhdf, tabhhuf.tb_deshhuf, tabhhsc.tb_deshhsc,
  tabhhtp.tb_deshhtp, tabhhtm.tb_deshhtm
`;

export async function getBacklog(db: DbInstanceConfig): Promise<BacklogRowRaw[]> {
  const pool = await getPoolFor(db.database);
  // Tipi record (default ['R'])
  const tipi = config.sync.backlogTipiRecord
    .filter((t) => /^[A-Za-z0-9]{1,3}$/.test(t))
    .map((t) => `'${t.toUpperCase()}'`)
    .join(',');
  if (!tipi) {
    throw new Error(
      'BACKLOG_TIPI_RECORD: nessun tipo record valido configurato (alfanumerico max 3 char)'
    );
  }
  // Tipi bolla/fattura: filtro OPZIONALE. Se BACKLOG_TIPI_BF e' vuoto, non
  // filtriamo (portiamo tutti i tipi: il filtraggio si fa dalle impostazioni
  // del dashboard). I valori sono interi non negativi (anche > 99, es. 207/300).
  const tipiBfList = config.sync.backlogTipiBollaFattura
    .map((t) => parseInt(t, 10))
    .filter((n) => !isNaN(n) && n >= 0);
  const tipiBfClause = tipiBfList.length
    ? `AND testord.td_tipobf IN (${tipiBfList.join(',')})`
    : '';
  // Stato evasione (default ['C']: in corso). Solo lettera singola.
  const flevas = config.sync.backlogFlevas
    .filter((t) => /^[A-Za-z]$/.test(t))
    .map((t) => `'${t.toUpperCase()}'`)
    .join(',');
  if (!flevas) {
    throw new Error(
      'BACKLOG_FLEVAS: nessun valore valido configurato (lettera singola, es. C / S / P)'
    );
  }
  const sqlText = BACKLOG_SQL
    .replace('__TIPI_RECORD__', tipi)
    .replace('__TIPI_BF_CLAUSE__', tipiBfClause)
    .replace('__FLEVAS__', flevas);
  const result = await pool
    .request()
    .input('scenario', sql.Int, config.sync.backlogScenario)
    .input('codditt', sql.VarChar, db.codditt)
    .input('fromDate', sql.VarChar, config.sync.backlogFromDate)
    .query(sqlText);
  return result.recordset;
}

// ============================================================
// Discovery (per debug)
// ============================================================

/**
 * Dumpa lo schema (colonne + tipi) di una lista di tabelle dal DB indicato.
 * Usato dal comando CLI `--describe-tables` per capire i nomi reali delle
 * colonne quando le query falliscono con "Invalid column name".
 */
export async function describeTables(
  dbName: string,
  tables: string[]
): Promise<Record<string, Array<{ column: string; type: string; nullable: boolean }>>> {
  const pool = await getPoolFor(dbName);
  const out: Record<string, Array<{ column: string; type: string; nullable: boolean }>> = {};
  for (const t of tables) {
    const r = await pool
      .request()
      .input('table', sql.VarChar, t)
      .query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION
      `);
    out[t] = r.recordset.map((row: { COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; CHARACTER_MAXIMUM_LENGTH: number | null }) => ({
      column: row.COLUMN_NAME,
      type:
        row.CHARACTER_MAXIMUM_LENGTH
          ? `${row.DATA_TYPE}(${row.CHARACTER_MAXIMUM_LENGTH})`
          : row.DATA_TYPE,
      nullable: row.IS_NULLABLE === 'YES',
    }));
  }
  return out;
}

export async function discoverTables(dbName: string): Promise<string[]> {
  const pool = await getPoolFor(dbName);
  const result = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  return result.recordset.map((r: { TABLE_NAME: string }) => r.TABLE_NAME);
}

/**
 * Per il DB indicato, dumpa cosa c'e' in dwarehe: combinazioni di (codditt,
 * dw_scenario, dw_anno) con conteggi e somme dei valori principali.
 * Aiuta a capire dove sta il vero fatturato quando uno scenario sembra
 * "vuoto" perche' contiene solo ordini non ancora fatturati.
 */
export async function inspectDwarehe(
  dbName: string
): Promise<Array<{
  codditt: string;
  scenario: number;
  year: number;
  rows: number;
  sum_valfatt: number;
  sum_quantfatt: number;
  sum_valore: number;
  rows_with_valfatt: number;
}>> {
  const pool = await getPoolFor(dbName);
  const result = await pool.request().query(`
    SELECT
      codditt,
      dw_scenario                                    AS scenario,
      dw_anno                                        AS year,
      COUNT(*)                                       AS rows,
      ISNULL(SUM(dw_valfatt), 0)                     AS sum_valfatt,
      ISNULL(SUM(dw_quantfatt), 0)                   AS sum_quantfatt,
      ISNULL(SUM(dw_valore), 0)                      AS sum_valore,
      SUM(CASE WHEN ISNULL(dw_valfatt, 0) <> 0 THEN 1 ELSE 0 END) AS rows_with_valfatt
    FROM dwarehe
    GROUP BY codditt, dw_scenario, dw_anno
    ORDER BY codditt, dw_scenario, dw_anno DESC
  `);
  return result.recordset;
}

/**
 * Conta quante righe di dwarehe passerebbero il WHERE del sync revenues,
 * SENZA i JOIN. Utile per isolare se sono i JOIN che fanno sparire le righe
 * oppure il WHERE.
 */
export async function countRevenuesWhere(
  dbName: string,
  codditt: string,
  scenario: number,
  year: number
): Promise<{ rows_no_filter: number; rows_with_filter: number }> {
  const pool = await getPoolFor(dbName);
  const noFilter = await pool
    .request()
    .input('scenario', sql.Int, scenario)
    .input('codditt', sql.VarChar, codditt)
    .input('year', sql.Int, year)
    .query(`
      SELECT COUNT(*) AS total
      FROM dwarehe
      WHERE dw_scenario = @scenario AND codditt = @codditt AND dw_anno = @year
    `);

  const withFilter = await pool
    .request()
    .input('scenario', sql.Int, scenario)
    .input('codditt', sql.VarChar, codditt)
    .input('year', sql.Int, year)
    .query(`
      SELECT COUNT(*) AS total
      FROM dwarehe
      WHERE dw_scenario = @scenario AND codditt = @codditt AND dw_anno = @year
        AND NOT (
          ISNULL(dw_quantfatt, 0) = 0 AND
          ISNULL(dw_valfatt,   0) = 0 AND
          ISNULL(dw_vprovv,    0) = 0 AND
          ISNULL(dw_vprovvf,   0) = 0
        )
    `);

  return {
    rows_no_filter: noFilter.recordset[0]?.total ?? 0,
    rows_with_filter: withFilter.recordset[0]?.total ?? 0,
  };
}

/**
 * Diagnostica: dato un numero documento, restituisce tutte le righe dwarehe + i
 * relativi movord + testord, mostrando i campi di stato (sospeso, blocco, ecc.)
 * per capire perche' un ordine non viene escluso dal sync.
 */
export async function inspectOrder(
  dbName: string,
  numeroDocumento: string | number
): Promise<{
  dwarehe: Array<Record<string, unknown>>;
  movord: Array<Record<string, unknown>>;
  testord: Array<Record<string, unknown>>;
}> {
  const pool = await getPoolFor(dbName);
  const numDocStr = String(numeroDocumento);

  const dwa = await pool
    .request()
    .input('num', sql.VarChar, numDocStr)
    .query(`
      SELECT TOP 20
        codditt, dw_scenario, dw_tipork, dw_anno, dw_mese, dw_serie, dw_numdoc, dw_riga,
        dw_conto, dw_codart, dw_motipork, dw_moanno, dw_moserie, dw_monumord, dw_moriga,
        dw_vprovvo, dw_quantfatt, dw_valfatt, dw_quant
      FROM dwarehe
      WHERE CAST(dw_numdoc AS VARCHAR(50)) = @num
      ORDER BY dw_anno DESC, dw_serie, dw_riga
    `);

  const mov = await pool
    .request()
    .input('num', sql.VarChar, numDocStr)
    .query(`
      SELECT TOP 20
        codditt, mo_tipork, mo_anno, mo_serie, mo_numord, mo_riga,
        mo_codart, mo_quant, mo_quaeva, mo_valore, mo_flevas, mo_datcons
      FROM movord
      WHERE CAST(mo_numord AS VARCHAR(50)) = @num
      ORDER BY mo_anno DESC, mo_serie, mo_riga
    `);

  const test = await pool
    .request()
    .input('num', sql.VarChar, numDocStr)
    .query(`
      SELECT TOP 20
        codditt, td_tipork, td_anno, td_serie, td_numord, td_conto,
        td_tipobf, td_sospeso, td_blocco, td_flevas, td_flstam, td_aperto, td_confermato,
        td_datord, td_datcons,
        td_ultagg, td_opnome, td_datcreaz, td_opcreaz
      FROM testord
      WHERE CAST(td_numord AS VARCHAR(50)) = @num
      ORDER BY td_anno DESC, td_tipork, td_serie
    `);

  return {
    dwarehe: dwa.recordset,
    movord: mov.recordset,
    testord: test.recordset,
  };
}

export async function findCustomerByName(
  dbName: string,
  needle: string
): Promise<Array<{ an_conto: number; an_descr1: string; an_tipo: string }>> {
  const pool = await getPoolFor(dbName);
  const result = await pool
    .request()
    .input('needle', sql.VarChar, `%${needle}%`)
    .query(`
      SELECT TOP 20 an_conto, an_descr1, an_tipo
      FROM anagra
      WHERE an_descr1 LIKE @needle
      ORDER BY an_descr1 ASC
    `);
  return result.recordset;
}
