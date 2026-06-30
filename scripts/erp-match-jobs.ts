/**
 * Cross-check definitivo: per i jobBody/jobContainer dei fascicoli (Postgres),
 * cerca in commess.co_comme (intero) e raccoglie:
 *   - dati commessa (co_dtaper, co_dtchiu, co_chiusa, co_conto, co_descr1/2)
 *   - cliente (anagra.an_descr1)
 *   - inizio/fine produzione = MIN(lce_start)/MAX(lce_stop) da avlavp
 *
 * Riporta: copertura, esempi con avanzamento, esempi senza.
 */

import "dotenv/config";
import sql from "mssql";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const mssqlConfig: sql.config = {
  server: process.env.SQLSERVER_HOST!,
  port: Number(process.env.SQLSERVER_PORT ?? 1433),
  user: process.env.SQLSERVER_USER!,
  password: process.env.SQLSERVER_PASSWORD!,
  database: "ZATO",
  options: {
    encrypt: process.env.SQLSERVER_ENCRYPT === "true",
    trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "false",
  },
};

type Row = {
  job: string;
  jobInt: number | null;
  found: boolean;
  co_conto: number | null;
  cliente: string | null;
  co_descr1: string | null;
  co_descr2: string | null;
  co_dtaper: Date | null;
  co_dtchiu: Date | null;
  co_chiusa: string | null;
  n_av: number;
  min_start: Date | null;
  max_stop: Date | null;
};

async function main() {
  const pool = await sql.connect(mssqlConfig);
  console.log("✅ Connesso a ZATO SQL Server\n");

  const fascicoli = await prisma.machine.findMany({
    select: { code: true, jobBody: true, jobContainer: true },
  });

  const jobs = new Set<string>();
  for (const f of fascicoli) {
    if (f.jobBody) jobs.add(String(f.jobBody).trim());
    if (f.jobContainer) jobs.add(String(f.jobContainer).trim());
  }
  console.log(`📦 Fascicoli: ${fascicoli.length}, job unici: ${jobs.size}\n`);

  const results: Row[] = [];
  let count = 0;
  for (const job of jobs) {
    count++;
    if (count % 30 === 0) console.log(`   processati ${count}/${jobs.size}...`);

    const jobInt = /^\d+$/.test(job) ? Number(job) : null;
    if (jobInt === null) {
      results.push({
        job, jobInt: null, found: false,
        co_conto: null, cliente: null, co_descr1: null, co_descr2: null,
        co_dtaper: null, co_dtchiu: null, co_chiusa: null,
        n_av: 0, min_start: null, max_stop: null,
      });
      continue;
    }

    const c = await pool.request()
      .input("c", sql.Int, jobInt)
      .query(`
        SELECT TOP 1
          co_comme, co_conto, co_descr1, co_descr2,
          co_dtaper, co_dtchiu, co_chiusa
        FROM commess
        WHERE co_comme = @c;
      `);

    if (c.recordset.length === 0) {
      results.push({
        job, jobInt, found: false,
        co_conto: null, cliente: null, co_descr1: null, co_descr2: null,
        co_dtaper: null, co_dtchiu: null, co_chiusa: null,
        n_av: 0, min_start: null, max_stop: null,
      });
      continue;
    }

    const com = c.recordset[0];

    // Cliente
    let cliente: string | null = null;
    if (com.co_conto && com.co_conto !== 0) {
      const cli = await pool.request()
        .input("conto", sql.Int, com.co_conto)
        .query<{ an_descr1: string }>(`
          SELECT TOP 1 an_descr1 FROM anagra WHERE an_conto = @conto AND an_tipo='C';
        `);
      cliente = cli.recordset[0]?.an_descr1?.trim() ?? null;
    }

    // Avanzamento
    const a = await pool.request()
      .input("c", sql.Int, jobInt)
      .query<{ n: number; min_s: Date | null; max_e: Date | null }>(`
        SELECT COUNT(*) AS n, MIN(lce_start) AS min_s, MAX(lce_stop) AS max_e
        FROM avlavp
        WHERE lce_commeca = @c;
      `);
    const av = a.recordset[0];

    results.push({
      job, jobInt, found: true,
      co_conto: com.co_conto,
      cliente,
      co_descr1: com.co_descr1?.trim() ?? null,
      co_descr2: com.co_descr2?.trim() ?? null,
      co_dtaper: com.co_dtaper,
      co_dtchiu: com.co_dtchiu,
      co_chiusa: com.co_chiusa,
      n_av: av.n ?? 0,
      min_start: av.min_s ?? null,
      max_stop: av.max_e ?? null,
    });
  }

  const found = results.filter((r) => r.found);
  const withAv = found.filter((r) => r.n_av > 0);
  const sentinelChiusa = (d: Date | null) =>
    d && d.getFullYear() < 2099 ? d : null;

  console.log(`\n📊 Job trovati come commess.co_comme: ${found.length}/${jobs.size}`);
  console.log(`📊 ... di cui con avanzamenti avlavp: ${withAv.length}/${found.length}`);

  console.log("\n── Top 15 job CON avanzamenti (= produzione tracciata) ──");
  console.table(
    withAv.slice(0, 15).map((r) => ({
      job: r.job,
      cliente: r.cliente?.slice(0, 25) ?? "—",
      descr: r.co_descr1?.slice(0, 25) ?? "",
      aperta: r.co_dtaper?.toISOString().slice(0, 10),
      chiusa: sentinelChiusa(r.co_dtchiu)?.toISOString().slice(0, 10) ?? r.co_chiusa,
      n_av: r.n_av,
      inizio_prod: r.min_start?.toISOString().slice(0, 10) ?? "—",
      fine_prod: r.max_stop?.toISOString().slice(0, 10) ?? "—",
    })),
  );

  console.log("\n── 10 esempi job trovati ma senza righe in avlavp ──");
  console.table(
    found.filter((r) => r.n_av === 0).slice(0, 10).map((r) => ({
      job: r.job,
      cliente: r.cliente?.slice(0, 25) ?? "—",
      descr: r.co_descr1?.slice(0, 25) ?? "",
      aperta: r.co_dtaper?.toISOString().slice(0, 10),
      chiusa: r.co_chiusa,
    })),
  );

  console.log("\n── Job NON trovati (assenti da commess) ──");
  console.log(
    results.filter((r) => !r.found).map((r) => r.job).join(", "),
  );

  await pool.close();
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
