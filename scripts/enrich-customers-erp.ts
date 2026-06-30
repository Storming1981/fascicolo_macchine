/**
 * Arricchisce i clienti attivi (con interventi o cantieri) con i dati del
 * gestionale (anagra: città/provincia/paese + conto ERP) e ne geocodifica la
 * città per posizionare i cantieri sul punto reale.
 *
 * Catena: Customer → una sua Machine con job numerico → commess.co_conto →
 *         anagra (città/paese) → geocoding (Nominatim) → Site.lat/lng.
 *
 * Uso: `npm run service:enrich-customers`.
 * Throttle geocoding ~1.1s/richiesta (fair use Nominatim).
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { isErpConfigured, getErpCustomerForJob } from "../src/lib/erp";
import { resolveCountry } from "../src/lib/domain";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const geoCache = new Map<string, [number, number] | null>();

async function geocode(query: string, countryCode: string): Promise<[number, number] | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const key = `${q}|${countryCode}`.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", "1");
  if (countryCode && countryCode !== "XX") u.searchParams.set("countrycodes", countryCode.toLowerCase());
  try {
    const res = await fetch(u.toString(), {
      headers: { "user-agent": "ZATO-Fascicolo-Tecnico/1.0 (enrich script)", accept: "application/json" },
    });
    if (res.ok) {
      const arr = (await res.json()) as { lat?: string; lon?: string }[];
      const hit = Array.isArray(arr) ? arr[0] : null;
      if (hit?.lat && hit?.lon) {
        const r: [number, number] = [Number(hit.lat), Number(hit.lon)];
        geoCache.set(key, r);
        await sleep(1100);
        return r;
      }
    }
  } catch {
    /* rete non disponibile */
  }
  geoCache.set(key, null);
  await sleep(1100);
  return null;
}

function firstNumericJob(m: { job: string | null; jobBody: string | null; jobContainer: string | null }): string | null {
  for (const j of [m.job, m.jobBody, m.jobContainer]) {
    if (j && /^\d+$/.test(j.trim())) return j.trim();
  }
  return null;
}

async function main() {
  console.log("🌍 Arricchimento clienti (ERP anagra + geocoding)…\n");
  const erpOn = isErpConfigured();
  if (!erpOn) console.log("  ⚠️ Gestionale non configurato: salto l'anagra, geocodifico solo per nome/città esistente.\n");

  const all = process.argv.includes("--all");
  console.log(all ? "  modalità: TUTTI i clienti\n" : "  modalità: solo clienti attivi (interventi/cantieri)\n");
  const customers = await prisma.customer.findMany({
    where: all ? {} : { OR: [{ interventi: { some: {} } }, { sites: { some: {} } }] },
    include: {
      machines: { select: { job: true, jobBody: true, jobContainer: true }, take: 8 },
      sites: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });
  console.log(`  ${customers.length} clienti attivi da elaborare\n`);

  let erpUpdated = 0;
  let geocoded = 0;

  for (const c of customers) {
    let city = c.city;
    let province = c.province;
    let countryCode = c.countryCode;
    let countryLabel = c.country;
    let erpConto = c.erpConto;

    // 1) anagra dal gestionale via job
    if (erpOn) {
      const job = c.machines.map(firstNumericJob).find(Boolean) as string | undefined;
      if (job) {
        try {
          const erp = await getErpCustomerForJob(job);
          if (erp) {
            const country = erp.countryIso ? resolveCountry(erp.countryIso) : resolveCountry(erp.countryName);
            city = erp.city ?? city;
            province = erp.province ?? province;
            if (country.code !== "XX") {
              countryCode = country.code;
              countryLabel = country.label;
            }
            erpConto = erp.conto;
            await prisma.customer.update({
              where: { id: c.id },
              data: { erpConto, city, province, country: countryLabel, countryCode },
            });
            erpUpdated++;
          }
        } catch (e) {
          console.log(`  ! ERP ${c.name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
        }
      }
    }

    // 2) geocoding città (o nome) → coordinate del cantiere
    const query = city ? [city, province].filter(Boolean).join(", ") : c.name;
    const coords = await geocode(query, countryCode);
    if (coords) {
      if (c.sites.length) {
        await prisma.site.update({
          where: { id: c.sites[0].id },
          data: { lat: coords[0], lng: coords[1], city: city ?? undefined, province: province ?? undefined },
        });
      } else {
        await prisma.site.create({
          data: {
            customerId: c.id,
            name: `Stabilimento ${city || c.name}`.trim(),
            city,
            province,
            lat: coords[0],
            lng: coords[1],
            status: "ok",
          },
        });
      }
      geocoded++;
      console.log(`  ✓ ${c.name} → ${query} [${countryCode}] (${coords[0].toFixed(3)}, ${coords[1].toFixed(3)})`);
    } else {
      console.log(`  · ${c.name} → nessuna geo per "${query}"`);
    }
  }

  console.log(`\n✅ Clienti aggiornati da ERP: ${erpUpdated} · cantieri geocodificati: ${geocoded}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
