/**
 * Esplorazione read-only del DB SQL Server ZATO (gestionale).
 *
 * Obiettivo: capire dove trovare anagrafiche commesse, clienti, ordini e
 * avanzamento produzione, per agganciare i dati ai fascicoli tecnici.
 *
 * Avvio: npx tsx scripts/erp-explore.ts
 */

import "dotenv/config";
import sql from "mssql";

const config: sql.config = {
  server: process.env.SQLSERVER_HOST!,
  port: Number(process.env.SQLSERVER_PORT ?? 1433),
  user: process.env.SQLSERVER_USER!,
  password: process.env.SQLSERVER_PASSWORD!,
  database: process.env.SQLSERVER_DATABASE ?? "ZATO",
  options: {
    encrypt: process.env.SQLSERVER_ENCRYPT === "true",
    trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "false",
    enableArithAbort: true,
  },
  requestTimeout: 60_000,
  connectionTimeout: 15_000,
};

// Parole chiave per pre-filtrare le tabelle interessanti
const KEYWORDS = [
  "comme", // commesse
  "clien", // clienti
  "ordi",  // ordini
  "avan",  // avanzamento
  "produ", // produzione
  "lavor", // lavorazioni
  "fase",  // fasi
  "timbr", // timbrature
  "job",
  "ddt",
  "anagr",
];

async function main() {
  console.log(`\n📡 Connessione a ${config.server}:${config.port}/${config.database}...`);
  const pool = await sql.connect(config);
  console.log("✅ Connesso.\n");

  // 1) Lista database disponibili (per sicurezza)
  const dbs = await pool.request().query<{ name: string }>(
    `SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name`,
  );
  console.log("📚 Database utente sul server:");
  for (const row of dbs.recordset) console.log("   -", row.name);
  console.log();

  // 2) Tutte le tabelle del DB corrente (schema + nome + n. colonne + righe stimate)
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
  console.log(`📋 Tabelle totali nel DB ${config.database}: ${tables.length}\n`);

  // 3) Filtro tabelle interessanti per keyword
  const matchKeyword = (name: string) =>
    KEYWORDS.some((k) => name.toLowerCase().includes(k));

  const interesting = tables.filter(
    (t) => matchKeyword(t.table_name) || matchKeyword(t.schema_name),
  );

  console.log(`🎯 Tabelle candidate (commesse/clienti/ordini/avanzamento): ${interesting.length}\n`);
  for (const t of interesting) {
    console.log(
      `   • [${t.schema_name}].[${t.table_name}]  cols=${t.column_count}  rows≈${t.row_count}`,
    );
  }
  console.log();

  // 4) Per ogni tabella candidata: schema colonne + primissimo record
  for (const t of interesting) {
    const fqName = `[${t.schema_name}].[${t.table_name}]`;
    console.log(`\n──────────────────────────────────────────────────────────────`);
    console.log(`📑 ${fqName}  (cols=${t.column_count}, rows≈${t.row_count})`);
    console.log(`──────────────────────────────────────────────────────────────`);

    // colonne
    const cols = await pool.request()
      .input("schema", sql.NVarChar, t.schema_name)
      .input("table", sql.NVarChar, t.table_name)
      .query<{
        column_name: string;
        data_type: string;
        max_len: number | null;
        is_nullable: string;
      }>(`
        SELECT
          COLUMN_NAME       AS column_name,
          DATA_TYPE         AS data_type,
          CHARACTER_MAXIMUM_LENGTH AS max_len,
          IS_NULLABLE       AS is_nullable
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION;
      `);

    for (const c of cols.recordset) {
      const len = c.max_len ? `(${c.max_len})` : "";
      const nul = c.is_nullable === "YES" ? "  NULL" : "  NOT NULL";
      console.log(`   - ${c.column_name.padEnd(35)} ${c.data_type}${len}${nul}`);
    }

    // primo record (se la tabella non è vuota)
    if (t.row_count > 0) {
      try {
        const sample = await pool.request().query(`SELECT TOP 1 * FROM ${fqName}`);
        if (sample.recordset.length > 0) {
          console.log(`   ▶ esempio record:`);
          const row = sample.recordset[0];
          for (const [k, v] of Object.entries(row)) {
            const s = v === null ? "NULL" : String(v).slice(0, 80);
            console.log(`        ${k.padEnd(35)} = ${s}`);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`   ⚠ impossibile leggere esempio: ${msg}`);
      }
    } else {
      console.log("   (tabella vuota)");
    }
  }

  await pool.close();
  console.log("\n✅ Esplorazione completata.\n");
}

main().catch((err) => {
  console.error("\n❌ Errore esplorazione:", err);
  process.exit(1);
});
