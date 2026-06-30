/**
 * Probe brute-force per un singolo job: lo cerco in qualunque colonna varchar
 * di tabelle "candidate" (testord, movord, commess, fedatiord, fetestmag,
 * testmag, allole). Stampo dove appare.
 */

import "dotenv/config";
import sql from "mssql";

const config: sql.config = {
  server: process.env.SQLSERVER_HOST!,
  port: Number(process.env.SQLSERVER_PORT ?? 1433),
  user: process.env.SQLSERVER_USER!,
  password: process.env.SQLSERVER_PASSWORD!,
  database: "ZATO",
  options: {
    encrypt: process.env.SQLSERVER_ENCRYPT === "true",
    trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "false",
  },
  requestTimeout: 120_000,
};

const JOBS_TO_PROBE = [
  "1260777", // unmatched
  "1260100",
  "1240280", // matched in commess
  "1230514", // matched in commess
  "22018",
  "19006",
  "5260341",
];

const SEARCH_TABLES = [
  "commess",     // co_descr1, co_descr2, co_comme
  "testord",     // td_riferim, td_numord
  "movord",      // mo_*
  "fedatiord",   // ?
  "testmag",     // tm_riferim
  "fetestmag",
];

async function findVarcharColumns(pool: sql.ConnectionPool, table: string) {
  const r = await pool.request()
    .input("t", sql.NVarChar, table)
    .query<{ column_name: string; data_type: string; max_len: number | null }>(`
      SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, CHARACTER_MAXIMUM_LENGTH AS max_len
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @t
        AND DATA_TYPE IN ('varchar','nvarchar','char','nchar')
        AND (CHARACTER_MAXIMUM_LENGTH IS NULL OR CHARACTER_MAXIMUM_LENGTH = -1 OR CHARACTER_MAXIMUM_LENGTH >= 5)
      ORDER BY ORDINAL_POSITION;
    `);
  return r.recordset.map((c) => c.column_name);
}

async function findIntColumns(pool: sql.ConnectionPool, table: string) {
  const r = await pool.request()
    .input("t", sql.NVarChar, table)
    .query<{ column_name: string }>(`
      SELECT COLUMN_NAME AS column_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @t
        AND DATA_TYPE IN ('int','bigint','smallint','numeric','decimal')
      ORDER BY ORDINAL_POSITION;
    `);
  return r.recordset.map((c) => c.column_name);
}

async function probeJob(pool: sql.ConnectionPool, job: string) {
  console.log(`\n══════════════ JOB "${job}" ══════════════`);
  const asInt = /^\d+$/.test(job) ? Number(job) : null;

  for (const t of SEARCH_TABLES) {
    const varCols = await findVarcharColumns(pool, t);
    const intCols = asInt !== null ? await findIntColumns(pool, t) : [];

    if (varCols.length === 0 && intCols.length === 0) continue;

    // Una sola query con OR su tutte le colonne (esatto)
    const conditions: string[] = [];
    if (varCols.length > 0) {
      conditions.push(
        varCols.map((c) => `[${c}] = '${job.replace(/'/g, "''")}'`).join(" OR "),
      );
    }
    if (asInt !== null && intCols.length > 0) {
      conditions.push(intCols.map((c) => `[${c}] = ${asInt}`).join(" OR "));
    }
    const whereSql = conditions.join(" OR ");

    try {
      const r = await pool.request().query<{ matched_col: string; n: number }>(`
        SELECT TOP 1 1 AS hit
        FROM ${t}
        WHERE ${whereSql};
      `);
      if (r.recordset.length === 0) {
        console.log(`   ${t.padEnd(15)}  no match`);
        continue;
      }
      // Trovato qualcosa: capisci dove
      const cols: string[] = [];
      for (const c of varCols) {
        const e = await pool.request()
          .input("v", sql.NVarChar, job)
          .query(`SELECT COUNT(*) AS n FROM ${t} WHERE [${c}] = @v;`);
        if (e.recordset[0].n > 0) cols.push(`${c}(varchar)=${e.recordset[0].n}`);
      }
      if (asInt !== null) {
        for (const c of intCols) {
          const e = await pool.request()
            .input("v", sql.Int, asInt)
            .query(`SELECT COUNT(*) AS n FROM ${t} WHERE [${c}] = @v;`);
          if (e.recordset[0].n > 0) cols.push(`${c}(int)=${e.recordset[0].n}`);
        }
      }
      console.log(`   ${t.padEnd(15)}  ✔  ${cols.join(", ")}`);
    } catch (e) {
      console.log(`   ${t.padEnd(15)}  ⚠ ${(e as Error).message.slice(0, 80)}`);
    }
  }
}

async function main() {
  const pool = await sql.connect(config);
  console.log("✅ Connesso\n");
  for (const j of JOBS_TO_PROBE) await probeJob(pool, j);
  await pool.close();
  console.log("\n✅ Fine.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
