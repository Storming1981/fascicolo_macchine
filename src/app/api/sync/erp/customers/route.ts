import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";
import { resolveCountry } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync/erp/customers
 *
 * Riceve dal sync-agent l'anagrafica clienti (da `anagra`, an_tipo='C') per i
 * conti presenti nei fascicoli e fa upsert dei `Customer` per `erpConto`, così
 * l'anagrafica del modulo Service resta allineata al gestionale anche sulla VPS
 * (dove non c'è connessione diretta al SQL Server).
 *
 * Body: { customers: Array<{ conto, name, city?, province?, countryIso?, countryName? }> }
 * Autenticazione: Bearer sk_sync_ (SYNC_API_KEY).
 */

type Incoming = {
  conto?: unknown;
  name?: unknown;
  city?: unknown;
  province?: unknown;
  countryIso?: unknown;
  countryName?: unknown;
};

/** Prossimo codice cliente libero C-NNN. */
async function nextCustomerCode(): Promise<string> {
  const last = await prisma.customer.findFirst({
    where: { code: { startsWith: "C-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let n = 0;
  if (last) {
    const p = parseInt(last.code.replace("C-", ""), 10);
    if (!Number.isNaN(p)) n = p;
  }
  for (let s = n + 1; ; s++) {
    const code = `C-${String(s).padStart(3, "0")}`;
    if (!(await prisma.customer.findUnique({ where: { code } }))) return code;
  }
}

export async function POST(req: Request) {
  if (!isSyncConfigured())
    return NextResponse.json({ error: "Sync non configurato" }, { status: 503 });
  if (!isValidSyncRequest(req))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  let body: { customers?: Incoming[] } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.customers))
    return NextResponse.json({ error: "Campo 'customers' mancante" }, { status: 400 });

  const t = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
  let upserted = 0;

  for (const c of body.customers) {
    const conto = typeof c?.conto === "number" ? c.conto : Number(c?.conto);
    if (!Number.isFinite(conto) || conto <= 0) continue;
    const name = t(c?.name);
    if (!name) continue;
    const city = t(c?.city);
    const province = t(c?.province);
    const resolved = resolveCountry(t(c?.countryIso) || t(c?.countryName));
    const country = resolved.code !== "XX" ? resolved.label : "Italia";
    const countryCode = resolved.code !== "XX" ? resolved.code : "IT";

    // 1) per erpConto → 2) per nome esatto (aggancia il conto) → 3) crea
    const existing =
      (await prisma.customer.findFirst({ where: { erpConto: conto } })) ??
      (await prisma.customer.findFirst({ where: { name: { equals: name, mode: "insensitive" } } }));

    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: {
          erpConto: conto,
          name,
          city: city ?? existing.city,
          province: province ?? existing.province,
          country,
          countryCode,
        },
      });
    } else {
      await prisma.customer.create({
        data: {
          code: await nextCustomerCode(),
          name,
          city,
          province,
          country,
          countryCode,
          erpConto: conto,
        },
      });
    }
    upserted++;
  }

  const total = await prisma.customer.count();
  return NextResponse.json({ status: "success", upserted, total });
}
