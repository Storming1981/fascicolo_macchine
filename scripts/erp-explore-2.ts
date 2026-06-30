/**
 * Esplorazione mirata: ZATO + ZATOMRP con keyword ampie + ricerca per nome
 * colonna (per intercettare tabelle "doc_*", "mst_*", "dot_*", "dlz_*", ecc.).
 *
 * Output sintetico: nome tabella + n. righe + colonne con "comme" o "data".
 */

import "dotenv/config";
import sql from "mssql";

const DBS = ["ZATO", "ZATOMRP", "ZATOMAG"];

// Keyword larghe (ERP Zucchetti AdHoc Revolution + termini funzionali)
const TABLE_KEYWORDS = [
  "comme", "clien", "ordi", "avan", "produ", "lavor", "fase", "ciclo",
  "timbr", "job", "ddt", "anagr", "doc", "mst", "dot", "dom", "ord",
  "mrp", "dlz", "ans", "mat", "prd", "bdp", "ft", "fatt", "des",
  "art", "kit", "dist", "lotto", "magaz", "movm",
];

// Colonne che indicano relazione a commessa/produzione/date
const COLUMN_KEYWORDS = [
  "comme", "co_comme", "datain", "datafin", "dtini", "dtfin",
  "dtapertura", "dtchiusura", "dataprod", "datalav",
];

function mkConfig(db: string): sql.config {
  return {
    server: process.env.SQLSERVER_HOST!,
    port: Number(process.env.SQLSERVER_PORT ?? 1433),
    user: process.env.SQLSERVER_USER!,
    password: process.env.SQLSERVER_PASSWORD!,
    database: db,
    options: {
      encrypt: process.env.SQLSERVER_ENCRYPT === "true",
      trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "false",
      enableArithAbort: true,
    },
    requestTimeout: 60_000,
    connectionTimeout: 15_000,
  };
}

async function exploreDb(db: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🗂  Database: ${db}`);
  console.log("=".repeat(70));

  const pool = await sql.connect(mkConfig(db));

  const tablesResult = await pool.request().query<{
    schema_name: string;
    table_name: string;
    column_count: number;
    row_count: number;
  }>(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS column_count,
      SUM(p.rows) AS row_count
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    INNER JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
    GROUP BY s.name, t.name, t.object_id
    ORDER BY s.name, t.name;
  `);

  const tables = tablesResult.recordset;
  console.log(`📋 Tabelle totali: ${tables.length}`);

  // Match per keyword nel nome tabella
  const lower = (s: string) => s.toLowerCase();
  const matchTable = tables.filter((t) =>
    TABLE_KEYWORDS.some((k) => lower(t.table_name).includes(k)),
  );

  // Match per keyword nel nome colonna — query unica
  const colMatch = await pool.request().query<{
    schema_name: string;
    table_name: string;
    column_name: string;
  }>(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      c.name AS column_name
    FROM sys.columns c
    INNER JOIN sys.tables t ON t.object_id = c.object_id
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE ${COLUMN_KEYWORDS.map((k) => `c.name LIKE '%${k}%'`).join(" OR ")}
    ORDER BY s.name, t.name, c.name;
  `);

  // Aggrego per tabella
  const colByTable = new Map<string, string[]>();
  for (const r of colMatch.recordset) {
    const key = `${r.schema_name}.${r.table_name}`;
    const arr = colByTable.get(key) ?? [];
    arr.push(r.column_name);
    colByTable.set(key, arr);
  }

  // Unione: tabelle che matchano per nome OR per colonna
  const candidates = new Map<
    string,
    { schema_name: string; table_name: string; row_count: number; matchedCols: string[] }
  >();

  for (const t of matchTable) {
    candidates.set(`${t.schema_name}.${t.table_name}`, {
      schema_name: t.schema_name,
      table_name: t.table_name,
      row_count: t.row_count,
      matchedCols: colByTable.get(`${t.schema_name}.${t.table_name}`) ?? [],
    });
  }
  for (const t of tables) {
    const key = `${t.schema_name}.${t.table_name}`;
    if (candidates.has(key)) continue;
    const cols = colByTable.get(key);
    if (!cols || cols.length === 0) continue;
    candidates.set(key, {
      schema_name: t.schema_name,
      table_name: t.table_name,
      row_count: t.row_count,
      matchedCols: cols,
    });
  }

  // Ordina: prima quelle con righe > 0, poi alfabetico
  const sorted = [...candidates.values()].sort((a, b) => {
    if ((a.row_count > 0) !== (b.row_count > 0)) {
      return a.row_count > 0 ? -1 : 1;
    }
    if (a.table_name !== b.table_name) return a.table_name.localeCompare(b.table_name);
    return 0;
  });

  console.log(`🎯 Candidate (nome o colonne rilevanti): ${sorted.length}\n`);
  for (const c of sorted) {
    const cols =
      c.matchedCols.length > 0 ? `  cols: ${c.matchedCols.join(", ")}` : "";
    console.log(
      `   • ${c.table_name.padEnd(28)} rows≈${String(c.row_count).padStart(8)}${cols}`,
    );
  }

  await pool.close();
}

async function main() {
  for (const db of DBS) {
    try {
      await exploreDb(db);
    } catch (e) {
      console.log(`\n❌ Errore su DB ${db}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log("\n✅ Fine esplorazione mirata.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
