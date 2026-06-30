/**
 * Approfondimento: schema completo e relazione job ↔ commessa ↔ avanzamento.
 *
 * - Schema completo di: commess, avlavp, lavcent, testord, movord, subcomm,
 *   anagra (solo colonne chiave), fetestmag, fedatiddt.
 * - Esempio 1 commessa reale (cerca per job "5250" o la prima con dt_aper recente).
 * - Conta degli avanzamenti su quella commessa e min/max date.
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
  requestTimeout: 60_000,
  connectionTimeout: 15_000,
};

const TABLES = [
  "commess",
  "subcomm",
  "avlavp",
  "lavcent",
  "cicli",
  "testord",
  "movord",
  "testmag",
  "fetestmag",
  "fedatiddt",
];

async function schemaOf(pool: sql.ConnectionPool, name: string) {
  const r = await pool.request()
    .input("t", sql.NVarChar, name)
    .query<{ column_name: string; data_type: string; max_len: number | null; is_nullable: string }>(`
      SELECT
        COLUMN_NAME       AS column_name,
        DATA_TYPE         AS data_type,
        CHARACTER_MAXIMUM_LENGTH AS max_len,
        IS_NULLABLE       AS is_nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @t
      ORDER BY ORDINAL_POSITION;
    `);
  return r.recordset;
}

async function main() {
  const pool = await sql.connect(config);
  console.log("✅ Connesso a ZATO\n");

  // 1) Stampa schema completo per ognuna delle tabelle chiave
  for (const t of TABLES) {
    const cols = await schemaOf(pool, t);
    console.log(`\n══ SCHEMA ${t} (${cols.length} colonne) ══`);
    for (const c of cols) {
      const len = c.max_len ? `(${c.max_len})` : "";
      const nul = c.is_nullable === "YES" ? "" : " NOT NULL";
      console.log(`   ${c.column_name.padEnd(32)} ${c.data_type}${len}${nul}`);
    }
  }

  // 2) Cerca la commessa "5250" (campione visto nel primo run)
  console.log("\n\n══════════════════════════════════════════════════════════════════════");
  console.log("🔎 Ricerca job 5250 in commess (per co_descr1 o co_descr2)");
  console.log("══════════════════════════════════════════════════════════════════════");

  const job = "5250";
  const c1 = await pool.request()
    .input("q", sql.NVarChar, `%${job}%`)
    .query(`
      SELECT TOP 20
        codditt, co_comme, co_conto, co_descr1, co_descr2,
        co_dtaper, co_dtagg, co_dtchiu, co_dtscad, co_chiusa, co_stato,
        co_anno, co_serie, co_numord, co_codtimp, co_codtcom, co_codprog
      FROM commess
      WHERE co_descr1 LIKE @q OR co_descr2 LIKE @q
      ORDER BY co_dtaper DESC;
    `);
  console.table(c1.recordset);

  if (c1.recordset.length > 0) {
    const com = c1.recordset[0];
    const coCommeca = com.co_comme;
    console.log(`\n✔ Uso co_comme=${coCommeca} per i passi successivi.\n`);

    // 3) Cliente
    console.log("── Cliente ──");
    const cli = await pool.request()
      .input("conto", sql.Int, com.co_conto)
      .query(`SELECT TOP 1 an_conto, an_descr1, an_citta, an_estcodiso, an_email
              FROM anagra WHERE an_conto = @conto;`);
    console.table(cli.recordset);

    // 4) Avanzamento produzione su quella commessa
    console.log("\n── Avanzamento produzione (avlavp) per la commessa ──");
    const av = await pool.request()
      .input("c", sql.Int, coCommeca)
      .query(`
        SELECT TOP 20 *
        FROM avlavp
        WHERE lce_commeca = @c
        ORDER BY 1 DESC;
      `);
    console.log(`   righe: ${av.recordset.length}`);
    if (av.recordset.length > 0) {
      console.log("   prima riga:");
      for (const [k, v] of Object.entries(av.recordset[0])) {
        console.log(`     ${k.padEnd(30)} = ${v === null ? "NULL" : String(v).slice(0, 80)}`);
      }
    }

    // 5) Min/max date avanzamento — provo a usare colonne data nell'avlavp
    console.log("\n── Min/max date colonne datetime in avlavp per la commessa ──");
    const avSchema = await schemaOf(pool, "avlavp");
    const dateCols = avSchema.filter((c) =>
      c.data_type === "datetime" || c.data_type === "date"
    ).map((c) => c.column_name);
    console.log(`   colonne data: ${dateCols.join(", ")}`);
    if (dateCols.length > 0) {
      const selects = dateCols
        .map((c) => `MIN([${c}]) AS min_${c}, MAX([${c}]) AS max_${c}`)
        .join(", ");
      const r = await pool.request().input("c", sql.Int, coCommeca).query(`
        SELECT ${selects}, COUNT(*) AS n_righe FROM avlavp WHERE lce_commeca = @c;
      `);
      console.table(r.recordset);
    }

    // 6) Ordini su quella commessa (testord/movord)
    console.log("\n── Ordini collegati (testord/movord) ──");
    const ord = await pool.request().input("c", sql.Int, coCommeca).query(`
      SELECT TOP 20
        td_tipork, td_anno, td_serie, td_numdoc, td_riga, td_codtdo, td_datdoc,
        td_codcli, td_descr, td_commeca, td_subcommeca
      FROM testord
      WHERE td_commeca = @c
      ORDER BY td_datdoc DESC;
    `).catch((e: Error) => ({ recordset: [{ ERROR: e.message }] }));
    console.table(ord.recordset);

    // 7) DDT collegati via movmag/testmag con commessa
    console.log("\n── Mov. magazzino con riferimento commessa (testmag) ──");
    const mm = await pool.request().input("c", sql.Int, coCommeca).query(`
      SELECT TOP 10
        tm_tipork, tm_anno, tm_serie, tm_numdoc, tm_datdoc, tm_dtiniz, tm_commeca, tm_subcommeca, tm_codtdo
      FROM testmag
      WHERE tm_commeca = @c
      ORDER BY tm_datdoc DESC;
    `).catch((e: Error) => ({ recordset: [{ ERROR: e.message }] }));
    console.table(mm.recordset);
  } else {
    console.log("⚠ Nessuna commessa trovata con descrizione 5250. Stampo le 5 più recenti:");
    const fallback = await pool.request().query(`
      SELECT TOP 5 co_comme, co_conto, co_descr1, co_descr2, co_dtaper, co_chiusa
      FROM commess ORDER BY co_dtaper DESC;
    `);
    console.table(fallback.recordset);
  }

  // 8) Per orientarci sui tipi documento (ordini cli, OP, ecc.)
  console.log("\n── Top tipi documento testord (per capire dove sono gli OP) ──");
  const tipi = await pool.request().query(`
    SELECT TOP 20 td_codtdo, COUNT(*) AS n
    FROM testord
    GROUP BY td_codtdo
    ORDER BY n DESC;
  `);
  console.table(tipi.recordset);

  console.log("\n── Top tipi documento testmag ──");
  const tipiM = await pool.request().query(`
    SELECT TOP 20 tm_codtdo, COUNT(*) AS n
    FROM testmag
    GROUP BY tm_codtdo
    ORDER BY n DESC;
  `);
  console.table(tipiM.recordset);

  await pool.close();
  console.log("\n✅ Fine.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
