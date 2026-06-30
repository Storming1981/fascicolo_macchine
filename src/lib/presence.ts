import "server-only";
import { prisma } from "./db";
import { geocode } from "./geocode";
import { isErpConfigured, getErpCustomerForJob } from "./erp";
import { resolveCountry } from "./domain";

/**
 * Presenze in cantiere dei tecnici.
 *
 * Il tecnico timbra su una COMMESSA (= Machine.job) tramite la web app esterna.
 * Qui:
 *  - risolviamo l'utente ZATO dal badge (User.badgeId), email o nome;
 *  - risolviamo il cantiere dalla commessa: Machine(job==commessa) → cliente →
 *    primo Site con coordinate;
 *  - manteniamo una sola presenza "aperta" (clockOut null) per tecnico.
 */

/** Considera "live" le presenze aperte degli ultimi N minuti (anti-timbrature orfane). */
const LIVE_WINDOW_MIN = 16 * 60; // 16 ore

export async function resolveUserId(opts: {
  badge?: string | null;
  matricola?: string | null;
  email?: string | null;
  name?: string | null;
}): Promise<string | null> {
  const { badge, matricola, email, name } = opts;
  if (badge) {
    const u = await prisma.user.findFirst({ where: { badgeId: badge }, select: { id: true } });
    if (u) return u.id;
  }
  if (matricola) {
    const u = await prisma.user.findFirst({ where: { matricola }, select: { id: true } });
    if (u) return u.id;
  }
  if (email) {
    const u = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (u) return u.id;
  }
  if (name) {
    const u = await prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (u) return u.id;
  }
  return null;
}

/** Coordinate approssimate per paese (centro nazione) per i pin senza geo esatta. */
const GEO_BY_CC: Record<string, [number, number]> = {
  IT: [44.5, 11.0], DE: [51.16, 10.45], SE: [59.33, 18.06], IS: [64.14, -21.94],
  NO: [59.91, 10.75], FI: [60.17, 24.94], FR: [48.85, 2.35], ES: [40.42, -3.7],
  GB: [51.51, -0.13], NL: [52.37, 4.9], BE: [50.85, 4.35], AT: [48.21, 16.37],
  CH: [46.95, 7.45], PL: [52.23, 21.01], US: [40.71, -74.0], DK: [55.68, 12.57],
  CZ: [50.08, 14.44], RO: [44.43, 26.1], PT: [38.72, -9.14], TR: [39.93, 32.86],
};

/**
 * Normalizza la commessa del timbratore verso il job ZATO.
 * Regola: la commessa timbratore = job + 2 cifre → si tolgono le ultime 2.
 * Prova comunque anche il valore grezzo.
 */
function commessaVariants(commessa: string): string[] {
  const c = commessa.trim();
  const v = new Set<string>([c]);
  if (/^\d+$/.test(c) && c.length > 2) v.add(c.slice(0, -2));
  return [...v];
}

/** Geocoding cantiere: città (preferita) o nome cliente, vincolato al paese. */
async function geocodeCustomer(cust: {
  name: string;
  city: string | null;
  province: string | null;
  countryCode: string;
}): Promise<[number, number] | null> {
  const query = cust.city
    ? [cust.city, cust.province].filter(Boolean).join(", ")
    : cust.name;
  return geocode(query, cust.countryCode);
}

/** Trova/crea il cantiere (Site con geo) per un cliente. Geocoda la città; fallback centro-nazione. */
async function ensureCustomerSite(customerId: string): Promise<string | null> {
  const cust = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, city: true, province: true, countryCode: true },
  });
  if (!cust) return null;
  const approx = GEO_BY_CC[cust.countryCode] ?? GEO_BY_CC.IT;

  const existing =
    (await prisma.site.findFirst({
      where: { customerId, lat: { not: null }, lng: { not: null } },
      select: { id: true, lat: true, lng: true },
    })) ?? (await prisma.site.findFirst({ where: { customerId }, select: { id: true, lat: true, lng: true } }));

  if (existing) {
    // se il cantiere è solo "centro nazione" (approssimato) prova a precisarlo
    const isApprox =
      existing.lat != null &&
      existing.lng != null &&
      Math.abs(existing.lat - approx[0]) < 0.001 &&
      Math.abs(existing.lng - approx[1]) < 0.001;
    if (isApprox) {
      const better = await geocodeCustomer(cust);
      if (better) await prisma.site.update({ where: { id: existing.id }, data: { lat: better[0], lng: better[1] } });
    }
    return existing.id;
  }

  const coords = (await geocodeCustomer(cust)) ?? approx;
  const site = await prisma.site.create({
    data: {
      customerId,
      name: `Stabilimento ${cust.city || cust.name}`.trim(),
      city: cust.city,
      province: cust.province,
      lat: coords[0],
      lng: coords[1],
      status: "ok",
    },
  });
  return site.id;
}

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

/**
 * Fallback: commessa non presente nei fascicoli → cerca il cliente nel
 * gestionale (commess→anagra) e lo crea/aggancia se serve. Ritorna il customerId.
 */
async function resolveCustomerViaErp(variants: string[]): Promise<string | null> {
  if (!isErpConfigured()) return null;
  for (const v of variants) {
    let erp;
    try {
      erp = await getErpCustomerForJob(v);
    } catch {
      continue;
    }
    if (!erp?.conto) continue;

    let customer =
      (await prisma.customer.findFirst({ where: { erpConto: erp.conto } })) ??
      (erp.name
        ? await prisma.customer.findFirst({ where: { name: { equals: erp.name, mode: "insensitive" } } })
        : null);

    const country = erp.countryIso ? resolveCountry(erp.countryIso) : resolveCountry(erp.countryName);
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          code: await nextCustomerCode(),
          name: erp.name || `Cliente ${erp.conto}`,
          city: erp.city,
          province: erp.province,
          country: country.code !== "XX" ? country.label : "Italia",
          countryCode: country.code !== "XX" ? country.code : "IT",
          erpConto: erp.conto,
        },
      });
    } else if (!customer.erpConto || (!customer.city && erp.city)) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          erpConto: erp.conto,
          city: customer.city ?? erp.city,
          province: customer.province ?? erp.province,
        },
      });
    }
    return customer.id;
  }
  return null;
}

/** Trova il cantiere (Site con geo) a partire da una commessa (Machine.job). */
export async function resolveSiteForCommessa(commessa?: string | null): Promise<string | null> {
  const c = (commessa ?? "").trim();
  if (!c) return null;
  const variants = commessaVariants(c);
  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { job: { in: variants } },
        { jobBody: { in: variants } },
        { jobContainer: { in: variants } },
      ],
    },
    select: { customerId: true },
  });
  if (machine?.customerId) return ensureCustomerSite(machine.customerId);

  // fallback: cliente dal gestionale (commessa non nei fascicoli)
  const custId = await resolveCustomerViaErp(variants);
  return custId ? ensureCustomerSite(custId) : null;
}

/** Trova un cantiere (Site con geo) dal nome cliente (colonna "Anagrafica"). */
export async function resolveSiteForCustomerName(name?: string | null): Promise<string | null> {
  const n = (name ?? "").trim();
  if (n.length < 3) return null;
  const customer = await prisma.customer.findFirst({
    where: { name: { equals: n, mode: "insensitive" } },
    select: { id: true },
  });
  const custId =
    customer?.id ??
    (
      await prisma.customer.findFirst({
        where: { name: { contains: n.split(/\s+/)[0], mode: "insensitive" } },
        select: { id: true },
      })
    )?.id;
  if (!custId) return null;
  return ensureCustomerSite(custId);
}

/** Sessione aperta letta dal timbratore (riga senza "Finito"). */
export type OpenSession = {
  externalId: string;
  matricola: string | null;
  commessa: string | null;
  anagrafica: string | null;
  startedAt: Date | null;
};

/**
 * Riconcilia le presenze "live" con le sessioni aperte del timbratore:
 * - crea/aggiorna una TechPresence aperta per ogni sessione aperta;
 * - chiude (clockOut) le presenze external aperte non più presenti.
 */
export async function reconcileOpenSessions(
  sessions: OpenSession[]
): Promise<{ open: number; closed: number }> {
  const openIds: string[] = [];
  for (const s of sessions) {
    const userId = await resolveUserId({ matricola: s.matricola });
    const siteId =
      (await resolveSiteForCommessa(s.commessa)) ?? (await resolveSiteForCustomerName(s.anagrafica));
    await prisma.techPresence.upsert({
      where: { externalId: s.externalId },
      update: {
        userId,
        siteId,
        commessa: s.commessa,
        clockIn: s.startedAt ?? undefined,
        clockOut: null,
        status: "on_site",
      },
      create: {
        externalId: s.externalId,
        userId,
        badgeId: s.matricola,
        commessa: s.commessa,
        siteId,
        clockIn: s.startedAt ?? new Date(),
        status: "on_site",
        source: "external",
      },
    });
    openIds.push(s.externalId);
  }

  const closed = await prisma.techPresence.updateMany({
    where: { source: "external", clockOut: null, externalId: { notIn: openIds } },
    data: { clockOut: new Date(), status: "off" },
  });
  return { open: sessions.length, closed: closed.count };
}

export type PresenceEvent = {
  userId?: string | null;
  badge?: string | null;
  matricola?: string | null;
  email?: string | null;
  name?: string | null;
  commessa?: string | null;
  siteId?: string | null;
  event: "in" | "out";
  at?: Date | null;
  source?: string;
  note?: string | null;
};

/** Registra una timbratura (entrata/uscita). Aggiorna la presenza aperta del tecnico. */
export async function recordPresence(ev: PresenceEvent): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const userId = ev.userId ?? (await resolveUserId(ev));
  const at = ev.at ?? new Date();
  const siteId = ev.siteId ?? (await resolveSiteForCommessa(ev.commessa));

  // presenza aperta corrente del tecnico (per badge se utente non risolto)
  const open = await prisma.techPresence.findFirst({
    where: {
      clockOut: null,
      ...(userId ? { userId } : { badgeId: ev.badge ?? "___none___" }),
    },
    orderBy: { clockIn: "desc" },
  });

  if (ev.event === "out") {
    if (open) {
      await prisma.techPresence.update({
        where: { id: open.id },
        data: { clockOut: at, status: "off" },
      });
      return { ok: true, id: open.id };
    }
    return { ok: true, reason: "Nessuna presenza aperta da chiudere" };
  }

  // event === "in": chiudi eventuale presenza aperta precedente, poi apri nuova
  if (open) {
    await prisma.techPresence.update({
      where: { id: open.id },
      data: { clockOut: at, status: "off" },
    });
  }
  const created = await prisma.techPresence.create({
    data: {
      userId,
      badgeId: ev.badge ?? null,
      commessa: ev.commessa ?? null,
      siteId,
      status: "on_site",
      clockIn: at,
      source: ev.source ?? "external",
      note: ev.note ?? null,
    },
  });
  return { ok: true, id: created.id };
}

export type LivePresence = {
  id: string;
  userId: string | null;
  techName: string | null;
  badgeId: string | null;
  commessa: string | null;
  siteId: string | null;
  siteName: string | null;
  customerName: string | null;
  lat: number | null;
  lng: number | null;
  clockIn: string;
};

/** Tecnici attualmente on-site (presenza aperta e recente). */
export async function getLivePresences(): Promise<LivePresence[]> {
  const since = new Date(Date.now() - LIVE_WINDOW_MIN * 60_000);
  const rows = await prisma.techPresence.findMany({
    where: { clockOut: null, clockIn: { gte: since } },
    orderBy: { clockIn: "desc" },
    include: {
      user: { select: { name: true } },
      site: { select: { name: true, lat: true, lng: true, customer: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    techName: r.user?.name ?? null,
    badgeId: r.badgeId,
    commessa: r.commessa,
    siteId: r.siteId,
    siteName: r.site?.name ?? null,
    customerName: r.site?.customer?.name ?? null,
    lat: r.site?.lat ?? null,
    lng: r.site?.lng ?? null,
    clockIn: r.clockIn.toISOString(),
  }));
}
