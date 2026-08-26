import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { resolveCountry, statusToPhase } from "@/lib/domain";
import { resolveCustomerLink } from "@/lib/machineService";
import type { MachineStatus } from "@prisma/client";

const VALID: MachineStatus[] = [
  "PRODUCTION",
  "TESTING",
  "SHIPPED",
  "INSTALLED",
  "MAINTENANCE",
  "SCRAPPED",
];

/** Campi testuali liberi: stringa vuota → null. */
const TEXT_FIELDS = [
  "jobBody",
  "jobContainer",
  "erpBodyOrder",
  "erpContainerOrder",
  "erpStandOrder",
  "erpBladesOrder",
  "plantType",
  "site",
  "plateWeight",
  "platePower",
  "plateVoltage",
  "pressureSettings",
] as const;

/** Etichette per l'annotazione a diario delle modifiche di anagrafica. */
const FIELD_LABEL: Record<string, string> = {
  job: "Job Number",
  jobBody: "Job Body",
  jobContainer: "Job Container",
  plantType: "Tipologia impianto",
  model: "Modello",
  year: "Anno",
  customer: "Cliente",
  country: "Paese",
  site: "Sito",
  productionStart: "Inizio produzione",
  deliveryDate: "Data consegna",
  plateWeight: "Peso",
  platePower: "Potenza",
  plateVoltage: "Tensione",
  pressureSettings: "Settaggi pressione",
};

const fmt = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : v instanceof Date
    ? v.toISOString().slice(0, 10)
    : String(v);

/**
 * Aggiorna un fascicolo macchina: stato/avanzamento e **tutta l'anagrafica**
 * (job, tipologia, modello, anno, cliente, paese, sito, date, targa tecnica).
 * Il cliente si aggiorna passando `customerId` dell'anagrafica clienti: così il
 * fascicolo resta agganciato al Customer e compare tra le sue macchine.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const { id } = await ctx.params;
  const b = await req.json();
  const data: Record<string, unknown> = {};

  if (b.status && VALID.includes(b.status)) data.status = b.status;
  if (typeof b.progress === "number") data.progress = Math.max(0, Math.min(100, b.progress));
  if (typeof b.notes === "string") data.notes = b.notes;
  if (typeof b.job === "string" && b.job.trim()) data.job = b.job.trim();
  for (const k of TEXT_FIELDS) {
    if (typeof b[k] === "string") data[k] = b[k].trim() || null;
  }

  // Anagrafica
  if (typeof b.model === "string" && b.model.trim()) data.model = b.model.trim();
  if (b.year !== undefined && b.year !== null && b.year !== "") {
    const y = Number(b.year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100)
      return NextResponse.json({ error: "Anno non valido" }, { status: 400 });
    data.year = y;
  }
  for (const k of ["productionStart", "deliveryDate"] as const) {
    if (typeof b[k] === "string") {
      if (!b[k].trim()) data[k] = null;
      else {
        const d = new Date(b[k]);
        if (Number.isNaN(d.getTime()))
          return NextResponse.json({ error: `Data non valida (${k})` }, { status: 400 });
        data[k] = d;
      }
    }
  }

  // Cliente: la fonte di verità è l'anagrafica clienti.
  if (b.customerId !== undefined) {
    if (b.customerId) {
      const link = await resolveCustomerLink({ customerId: String(b.customerId) });
      if (!link.id)
        return NextResponse.json({ error: "Cliente non trovato in anagrafica" }, { status: 400 });
      data.customerId = link.id;
      data.customer = link.name;
    } else {
      // scollegamento esplicito: resta il nome libero già presente
      data.customerId = null;
      if (typeof b.customer === "string" && b.customer.trim()) data.customer = b.customer.trim();
    }
  } else if (typeof b.customer === "string" && b.customer.trim()) {
    data.customer = b.customer.trim();
  }

  if (typeof b.countryCode === "string" && b.countryCode.trim()) {
    const c = resolveCountry(b.countryCode.trim());
    data.countryCode = c.code;
    data.country = c.label;
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  // snapshot precedente, per annotare a diario le correzioni di anagrafica
  const before = await prisma.machine.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Fascicolo non trovato" }, { status: 404 });

  const machine = await prisma.machine.update({ where: { id }, data });

  const changes = Object.keys(FIELD_LABEL)
    .filter((k) => k in data)
    .map((k) => {
      const prev = (before as unknown as Record<string, unknown>)[k];
      const next = (machine as unknown as Record<string, unknown>)[k];
      const a = fmt(prev);
      const bv = fmt(next);
      return a === bv ? null : `${FIELD_LABEL[k]}: ${a} → ${bv}`;
    })
    .filter(Boolean) as string[];

  if (changes.length) {
    await prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "note",
        title: "Anagrafica fascicolo aggiornata",
        note: changes.join(" · "),
        actorName: user.name,
        authorId: user.id,
      },
    });
  }

  if (b.status && VALID.includes(b.status)) {
    await prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: b.status as MachineStatus,
        type: "milestone",
        title: `Stato aggiornato: ${b.status}`,
        actorName: user.name,
        authorId: user.id,
      },
    });
  }
  return NextResponse.json({ ok: true, code: machine.code });
}
