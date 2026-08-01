import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";
import { resolveCountry } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync/erp/customers
 *
 * Riceve dal sync-agent l'anagrafica clienti (da `anagra`, an_tipo='C') e fa
 * upsert dei `Customer` per `erpConto`, così l'anagrafica del modulo Service
 * resta allineata al gestionale anche sulla VPS. Ottimizzato per grandi volumi:
 * carica gli esistenti una volta e decide in memoria (createMany + update solo
 * dei record realmente cambiati).
 *
 * Body: { customers: Array<{ conto, name, city?, province?, countryIso?, countryName? }> }
 * Autenticazione: Bearer sk_sync_ (SYNC_API_KEY).
 */

type Incoming = {
  conto?: unknown;
  name?: unknown;
  address?: unknown;
  city?: unknown;
  province?: unknown;
  countryIso?: unknown;
  countryName?: unknown;
};

/** Coordinate approssimate per paese (centro nazione) per i cantieri sincronizzati. */
const GEO_BY_CC: Record<string, [number, number]> = {
  IT: [44.5, 11.0], DE: [51.16, 10.45], SE: [59.33, 18.06], IS: [64.14, -21.94],
  NO: [59.91, 10.75], FI: [60.17, 24.94], FR: [48.85, 2.35], ES: [40.42, -3.7],
  GB: [51.51, -0.13], NL: [52.37, 4.9], BE: [50.85, 4.35], AT: [48.21, 16.37],
  CH: [46.95, 7.45], PL: [52.23, 21.01], US: [40.71, -74.0], DK: [55.68, 12.57],
  CZ: [50.08, 14.44], RO: [44.43, 26.1], PT: [38.72, -9.14], TR: [39.93, 32.86],
};

const norm = (s: string) => s.trim().toLowerCase();

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

  // indirizzo + countryCode per conto (per creare i cantieri di default)
  const metaByConto = new Map<number, { address: string | null; countryCode: string }>();

  // Esistenti in memoria: indicizzati per erpConto e per nome normalizzato
  const existing = await prisma.customer.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      province: true,
      country: true,
      countryCode: true,
      erpConto: true,
    },
  });
  type Existing = (typeof existing)[number];
  const byConto = new Map<number, Existing>();
  const byName = new Map<string, Existing>();
  let maxCode = 0;
  for (const e of existing) {
    if (e.erpConto) byConto.set(e.erpConto, e);
    byName.set(norm(e.name), e);
    const n = parseInt(e.code.replace(/^C-/, ""), 10);
    if (!Number.isNaN(n) && n > maxCode) maxCode = n;
  }

  const toCreate: {
    code: string;
    name: string;
    city: string | null;
    province: string | null;
    country: string;
    countryCode: string;
    erpConto: number;
  }[] = [];
  const toUpdate: { id: string; data: Record<string, unknown> }[] = [];

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
    metaByConto.set(conto, { address: t(c?.address), countryCode });

    const found = byConto.get(conto) ?? byName.get(norm(name));
    if (found) {
      // aggiorna solo se qualcosa è realmente cambiato (evita scritture inutili)
      const nextCity = city ?? found.city;
      const nextProv = province ?? found.province;
      const changed =
        found.erpConto !== conto ||
        found.name !== name ||
        found.city !== nextCity ||
        found.province !== nextProv ||
        found.country !== country ||
        found.countryCode !== countryCode;
      if (changed) {
        toUpdate.push({
          id: found.id,
          data: { erpConto: conto, name, city: nextCity, province: nextProv, country, countryCode },
        });
        // aggiorna la cache in memoria
        found.erpConto = conto;
        found.name = name;
        found.city = nextCity;
        found.province = nextProv;
        found.country = country;
        found.countryCode = countryCode;
      }
    } else {
      maxCode++;
      const code = `C-${String(maxCode).padStart(3, "0")}`;
      const rec = { code, name, city, province, country, countryCode, erpConto: conto };
      toCreate.push(rec);
      // registra nella cache per non duplicare nello stesso batch
      const cached: Existing = { id: "new", code, name, city, province, country, countryCode, erpConto: conto };
      byConto.set(conto, cached);
      byName.set(norm(name), cached);
    }
  }

  if (toCreate.length) await prisma.customer.createMany({ data: toCreate, skipDuplicates: true });
  // update a piccoli lotti concorrenti
  const CHUNK = 25;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    await Promise.all(
      toUpdate.slice(i, i + CHUNK).map((u) =>
        prisma.customer.update({ where: { id: u.id }, data: u.data }),
      ),
    );
  }

  // Cantiere di default: dall'indirizzo dell'anagrafica, per i clienti del batch
  // che NON hanno ancora nessun Site (così il campo "Cantiere" non resta vuoto e
  // non si duplica quello creato dalle timbrature). Coordinate = centro nazione.
  const contos = [...metaByConto.keys()];
  const custRows = await prisma.customer.findMany({
    where: { erpConto: { in: contos } },
    select: { id: true, name: true, erpConto: true, city: true, province: true, countryCode: true },
  });
  const custIds = custRows.map((c) => c.id);
  const withSites = new Set(
    (
      await prisma.site.findMany({
        where: { customerId: { in: custIds } },
        select: { customerId: true },
        distinct: ["customerId"],
      })
    ).map((s) => s.customerId),
  );
  const newSites = custRows
    .filter((c) => !withSites.has(c.id))
    .map((c) => {
      const meta = c.erpConto != null ? metaByConto.get(c.erpConto) : undefined;
      const [lat, lng] = GEO_BY_CC[c.countryCode] ?? GEO_BY_CC.IT;
      return {
        customerId: c.id,
        name: `Stabilimento ${c.city || c.name}`.trim(),
        city: c.city,
        province: c.province,
        address: meta?.address ?? null,
        lat,
        lng,
        status: "ok",
      };
    });
  let sitesCreated = 0;
  if (newSites.length) {
    const res = await prisma.site.createMany({ data: newSites });
    sitesCreated = res.count;
  }

  const total = await prisma.customer.count();
  return NextResponse.json({
    status: "success",
    upserted: toCreate.length + toUpdate.length,
    created: toCreate.length,
    updated: toUpdate.length,
    sitesCreated,
    total,
  });
}
