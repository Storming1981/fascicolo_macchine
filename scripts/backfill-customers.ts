/**
 * Backfill anagrafica clienti dai fascicoli esistenti.
 * Crea un Customer per ogni nome cliente distinto presente sui Machine e
 * collega i fascicoli (Machine.customerId). Idempotente: riusa i Customer
 * esistenti per nome e salta i fascicoli già collegati.
 * Uso: `npm run service:backfill-customers`.
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";

async function nextCodeFactory() {
  const last = await prisma.customer.findFirst({
    where: { code: { startsWith: "C-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let n = 0;
  if (last) {
    const parsed = parseInt(last.code.replace("C-", ""), 10);
    if (!Number.isNaN(parsed)) n = parsed;
  }
  return async function next(): Promise<string> {
    for (;;) {
      n += 1;
      const code = `C-${String(n).padStart(3, "0")}`;
      const exists = await prisma.customer.findUnique({ where: { code } });
      if (!exists) return code;
    }
  };
}

async function main() {
  console.log("👥 Backfill clienti dai fascicoli…\n");
  const nextCode = await nextCodeFactory();

  // mappa nome(normalizzato) -> customerId già esistente
  const existing = await prisma.customer.findMany({ select: { id: true, name: true } });
  const byName = new Map<string, string>();
  for (const c of existing) byName.set(c.name.trim().toLowerCase(), c.id);

  const machines = await prisma.machine.findMany({
    where: { customerId: null },
    select: { id: true, customer: true, country: true, countryCode: true },
  });

  // raggruppa per nome cliente
  const groups = new Map<
    string,
    { name: string; country: string; countryCode: string; machineIds: string[] }
  >();
  for (const m of machines) {
    const name = (m.customer ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        name,
        country: m.country || "Italia",
        countryCode: m.countryCode || "IT",
        machineIds: [],
      });
    }
    groups.get(key)!.machineIds.push(m.id);
  }

  let created = 0;
  let reused = 0;
  let linked = 0;

  for (const [key, g] of groups) {
    let customerId = byName.get(key);
    if (!customerId) {
      const code = await nextCode();
      const c = await prisma.customer.create({
        data: {
          code,
          name: g.name,
          country: g.country,
          countryCode: g.countryCode,
        },
      });
      customerId = c.id;
      byName.set(key, customerId);
      created += 1;
    } else {
      reused += 1;
    }
    const res = await prisma.machine.updateMany({
      where: { id: { in: g.machineIds } },
      data: { customerId },
    });
    linked += res.count;
  }

  console.log(`\n✅ Clienti creati: ${created} · riusati: ${reused} · fascicoli collegati: ${linked}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
