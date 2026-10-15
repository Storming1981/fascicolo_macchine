import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { userCan } from "@/lib/settings";
import { fmtDate } from "@/lib/format";

/**
 * Ricerca rapida della topbar.
 * Se il termine corrisponde a una matricola/serial di un componente (o al
 * codice fascicolo / job), apre direttamente quella macchina; altrimenti
 * ricade nella lista filtrata.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (url.searchParams.get("suggest") === "1") return NextResponse.json(await suggest(user, q));
  if (!q) return NextResponse.json({ type: "list", q: "" });

  // 1) match esatto: codice fascicolo, job, oppure matricola componente
  const exact = await prisma.machine.findFirst({
    where: {
      OR: [
        { code: { equals: q, mode: "insensitive" } },
        { job: { equals: q } },
        { jobBody: { equals: q } },
        { jobContainer: { equals: q } },
        {
          components: {
            some: { items: { some: { serial: { equals: q, mode: "insensitive" } } } },
          },
        },
      ],
    },
    select: { code: true },
  });
  if (exact) return NextResponse.json({ type: "machine", code: exact.code });

  // 1b) intervento per codice (INT-xxxx)
  const intervento = await prisma.intervento.findFirst({
    where: { code: { equals: q, mode: "insensitive" }, deletedAt: null },
    select: { id: true },
  });
  if (intervento) return NextResponse.json({ type: "intervento", id: intervento.id });

  // 1c) cliente per codice (C-xxx) o ragione sociale esatta
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { code: { equals: q, mode: "insensitive" } },
        { name: { equals: q, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (customer) return NextResponse.json({ type: "customer", id: customer.id });

  // 2) match parziale su matricola componente
  const partialSerial = await prisma.machine.findMany({
    where: {
      components: {
        some: { items: { some: { serial: { contains: q, mode: "insensitive" } } } },
      },
    },
    select: { code: true },
    take: 2,
  });
  if (partialSerial.length === 1) {
    return NextResponse.json({ type: "machine", code: partialSerial[0].code });
  }

  // 3) altrimenti lista filtrata (per cliente/modello/paese/ecc.)
  return NextResponse.json({ type: "list", q });
}

/* ── Suggerimenti della ricerca globale ─────────────────────────────────────
 * Mentre si scrive, la testata propone i risultati raggruppati per tipo invece
 * di indovinare una destinazione sola: prima "hoffman" portava all'elenco
 * macchine, e l'intervento o il rapportino cercato andavano ripescati a mano.
 * Ogni parola deve comparire (in qualunque campo), così "hoffmann bc14" trova
 * l'intervento giusto. Gli interventi seguono la visibilità del kanban.
 */
type Hit = { id: string; href: string; title: string; subtitle?: string; meta?: string };
export type SuggestResult = {
  q: string;
  groups: { key: string; label: string; hits: Hit[]; more?: { href: string; label: string } }[];
};

const PER_GROUP = 5;

async function suggest(
  user: { id: string; role: Parameters<typeof userCan>[0] },
  q: string
): Promise<SuggestResult> {
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length || q.length < 2) return { q, groups: [] };
  const ci = (w: string) => ({ contains: w, mode: "insensitive" as const });

  const service = await userCan(user.role, "service.view");
  const viewAll = service && (await userCan(user.role, "intervento.viewAll"));
  const scope = viewAll
    ? {}
    : { OR: [{ assignedTechId: user.id }, { participants: { some: { id: user.id } } }] };

  const machineWhere = {
    AND: words.map((w) => ({
      OR: [
        { code: ci(w) },
        { job: ci(w) },
        { jobBody: ci(w) },
        { jobContainer: ci(w) },
        { customer: ci(w) },
        { naCustomer: ci(w) },
        { site: ci(w) },
        { model: ci(w) },
        { plantType: ci(w) },
        { components: { some: { items: { some: { serial: ci(w) } } } } },
      ],
    })),
  };
  const interventoWhere = {
    deletedAt: null,
    ...scope,
    AND: words.map((w) => ({
      OR: [
        { code: ci(w) },
        { title: ci(w) },
        { commessa: ci(w) },
        { description: ci(w) },
        { customer: { name: ci(w) } },
        { site: { name: ci(w) } },
        { machine: { OR: [{ code: ci(w) }, { job: ci(w) }] } },
        { tech: { name: ci(w) } },
      ],
    })),
  };
  // Rapportini: per il testo scritto in cantiere (lavori, problematiche,
  // tecnico) oppure per l'intervento a cui appartengono.
  const rapportinoWhere = {
    intervento: { deletedAt: null, ...scope },
    AND: words.map((w) => ({
      OR: [
        { workDescription: ci(w) },
        { issues: ci(w) },
        { techName: ci(w) },
        {
          intervento: {
            OR: [
              { code: ci(w) },
              { commessa: ci(w) },
              { customer: { name: ci(w) } },
              { machine: { job: ci(w) } },
            ],
          },
        },
      ],
    })),
  };
  const customerWhere = {
    AND: words.map((w) => ({ OR: [{ name: ci(w) }, { code: ci(w) }, { city: ci(w) }] })),
  };

  const [machines, mCount, interventi, iCount, rapportini, rCount, customers, cCount] =
    await Promise.all([
      prisma.machine.findMany({
        where: machineWhere,
        orderBy: { createdAt: "desc" },
        take: PER_GROUP,
        select: { code: true, job: true, plantType: true, model: true, customer: true, naCustomer: true },
      }),
      prisma.machine.count({ where: machineWhere }),
      service
        ? prisma.intervento.findMany({
            where: interventoWhere,
            orderBy: { createdAt: "desc" },
            take: PER_GROUP,
            select: {
              id: true,
              code: true,
              title: true,
              commessa: true,
              status: true,
              customer: { select: { name: true } },
            },
          })
        : [],
      service ? prisma.intervento.count({ where: interventoWhere }) : 0,
      service
        ? prisma.rapportino.findMany({
            where: rapportinoWhere,
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: PER_GROUP,
            select: {
              id: true,
              date: true,
              workDescription: true,
              closed: true,
              intervento: { select: { id: true, code: true, customer: { select: { name: true } } } },
            },
          })
        : [],
      service ? prisma.rapportino.count({ where: rapportinoWhere }) : 0,
      service
        ? prisma.customer.findMany({
            where: customerWhere,
            orderBy: { name: "asc" },
            take: PER_GROUP,
            select: { id: true, name: true, code: true, city: true, country: true },
          })
        : [],
      service ? prisma.customer.count({ where: customerWhere }) : 0,
    ]);

  const enc = encodeURIComponent(q);
  const groups: SuggestResult["groups"] = [];
  if (interventi.length)
    groups.push({
      key: "interventi",
      label: "Interventi",
      hits: interventi.map((i) => ({
        id: i.id,
        href: `/service/interventi/${i.id}`,
        title: `${i.code} · ${i.title}`,
        subtitle: [i.customer?.name, i.commessa && `comm. ${i.commessa}`].filter(Boolean).join(" · "),
      })),
      more: iCount > PER_GROUP ? { href: `/service/interventi?q=${enc}`, label: `Tutti i ${iCount} interventi` } : undefined,
    });
  if (rapportini.length)
    groups.push({
      key: "rapportini",
      label: "Rapportini",
      hits: rapportini.map((r) => ({
        id: r.id,
        href: `/service/interventi/${r.intervento.id}#rap-${r.id}`,
        title: `${fmtDate(r.date)} · ${r.intervento.code}`,
        subtitle: [r.intervento.customer?.name, r.workDescription?.replace(/\s+/g, " ").slice(0, 80)]
          .filter(Boolean)
          .join(" · "),
        meta: r.closed ? "Firmato" : "Bozza",
      })),
      more: rCount > PER_GROUP ? { href: `/service/rapportini?q=${enc}`, label: `Tutti i ${rCount} rapportini` } : undefined,
    });
  if (machines.length)
    groups.push({
      key: "macchine",
      label: "Macchine",
      hits: machines.map((m) => ({
        id: m.code,
        href: `/macchine/${encodeURIComponent(m.code)}`,
        title: `${m.code} · job ${m.job}`,
        subtitle: [m.plantType, m.model, m.naCustomer || m.customer].filter(Boolean).join(" · "),
      })),
      more: mCount > PER_GROUP ? { href: `/macchine?q=${enc}`, label: `Tutte le ${mCount} macchine` } : undefined,
    });
  if (customers.length)
    groups.push({
      key: "clienti",
      label: "Clienti",
      hits: customers.map((c) => ({
        id: c.id,
        href: `/service/clienti/${c.id}`,
        title: c.name,
        subtitle: [c.code, c.city, c.country].filter(Boolean).join(" · "),
      })),
      more: cCount > PER_GROUP ? { href: `/service/clienti?q=${enc}`, label: `Tutti i ${cCount} clienti` } : undefined,
    });
  return { q, groups };
}
