import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { resolveCountry, statusToPhase } from "@/lib/domain";
import { jobFields, type JobFieldKey } from "@/lib/plant";
import { deleteUploads, removeScopeIfEmpty } from "@/lib/uploads";
import { resolveCustomerLink } from "@/lib/machineService";
import { isSheetKind, machineSheetKinds, sheetDef, sheetKindsFor } from "@/lib/allestimento";
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
  "naCustomer",
  "naCustomerCode",
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
  naCustomer: "Cliente ZATO NA",
  productionStart: "Inizio produzione",
  deliveryDate: "Data consegna",
  plateWeight: "Peso",
  platePower: "Potenza",
  plateVoltage: "Tensione",
  pressureSettings: "Settaggi pressione",
  sheetKinds: "Schede componenti",
};

/** Su mulini, cesoie e linee il `jobBody` è il **Job Pro**: a diario va così. */
function fieldLabel(key: string, plantType: string | null, sheets?: string[] | null): string {
  if (key === "jobBody" || key === "jobContainer") {
    const def = jobFields(plantType, sheets).find((j) => j.key === key);
    if (def) return def.label;
  }
  return FIELD_LABEL[key];
}

const fmt = (v: unknown) =>
  // l'unico campo a elenco sono le schede previste: vuoto = tutte quelle della
  // tipologia, che a diario si legge meglio del nulla
  Array.isArray(v)
    ? v.length
      ? v.map((k) => (isSheetKind(k) ? sheetDef(k).code : String(k))).join(" + ")
      : "tutte quelle della tipologia"
    : v === null || v === undefined || v === ""
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
  if (typeof b.notes === "string") data.notes = b.notes;
  if (typeof b.job === "string" && b.job.trim()) data.job = b.job.trim();
  for (const k of TEXT_FIELDS) {
    if (typeof b[k] === "string") data[k] = b[k].trim() || null;
  }

  // Schede di allestimento previste dal fascicolo: si validano sulla tipologia
  // che il fascicolo AVRA' dopo il salvataggio, quindi si risolvono piu' sotto,
  // quando c'e' anche lo stato precedente.
  const wantSheets: string[] | null = Array.isArray(b.sheetKinds)
    ? (b.sheetKinds as unknown[]).filter(isSheetKind)
    : null;

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

  if (Object.keys(data).length === 0 && wantSheets === null)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  // snapshot precedente, per annotare a diario le correzioni di anagrafica
  const before = await prisma.machine.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Fascicolo non trovato" }, { status: 404 });

  // Cambiando tipologia la scelta delle schede non vuol piu' dire niente: si
  // azzera (= tutte quelle della nuova tipologia) invece di lasciare appeso un
  // elenco che parla di un'altra macchina. Tutte = elenco vuoto, cosi' una
  // scheda aggiunta domani alla tipologia compare anche sui fascicoli di oggi.
  const plantAfter = (data.plantType as string | null | undefined) ?? before.plantType;
  const plantChanged = "plantType" in data && data.plantType !== before.plantType;
  if (wantSheets || plantChanged) {
    const all = sheetKindsFor(plantAfter);
    const picked = wantSheets && !plantChanged ? machineSheetKinds(plantAfter, wantSheets) : all;
    data.sheetKinds = picked.length === all.length ? [] : picked;

    // Un fascicolo di solo container non ha un corpo trituratore: il suo Job
    // Body sparisce dalla pagina, quindi deve sparire anche dal dato — un
    // numero nascosto in un campo che non si vede piu' finirebbe lo stesso
    // nelle query del gestionale. Il cambio va a diario, quindi resta tracciato.
    const keep = jobFields(plantAfter, picked).map((j) => j.key);
    for (const k of ["jobBody", "jobContainer"] as JobFieldKey[])
      if (!keep.includes(k)) data[k] = null;
  }

  const machine = await prisma.machine.update({ where: { id }, data });

  const changes = Object.keys(FIELD_LABEL)
    .filter((k) => k in data)
    .map((k) => {
      const prev = (before as unknown as Record<string, unknown>)[k];
      const next = (machine as unknown as Record<string, unknown>)[k];
      const a = fmt(prev);
      const bv = fmt(next);
      return a === bv ? null : `${fieldLabel(k, machine.plantType, before.sheetKinds)}: ${a} → ${bv}`;
    })
    .filter(Boolean) as string[];

  // Una convalida che sopravvive alle correzioni non convalida più niente:
  // se l'anagrafica cambia dopo la firma, la firma decade e va rifatta.
  if (changes.length && before.anagraficaSignedAt) {
    await prisma.machine.update({
      where: { id },
      data: {
        anagraficaSignedById: null,
        anagraficaSignedByName: null,
        anagraficaSignedAt: null,
        anagraficaSignature: null,
      },
    });
    changes.push(
      `Convalida anagrafica decaduta (era firmata da ${before.anagraficaSignedByName ?? "—"})`
    );
  }

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

/**
 * **Elimina davvero** un fascicolo: riga, componenti, matricole, foto,
 * documenti, diario, firme, schede e note. Non e' il cambio di stato a
 * *Dismessa* — quello e' il fine vita di una macchina che e' esistita; questo
 * serve ai fascicoli aperti per errore o doppi, che non devono restare in
 * elenco a sporcare conteggi e ricerche.
 *
 * **Solo ADMIN**, e non per permesso in matrice: `machine.edit` ce l'hanno
 * anche i responsabili, e una cancellazione irreversibile non e' una modifica.
 * Il codice del fascicolo va riscritto nella richiesta: e' l'unico modo per
 * essere certi che non sia un clic andato a male.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json(
      { error: "Solo un amministratore puo' eliminare un fascicolo" },
      { status: 403 }
    );
  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, code: true, job: true, customer: true },
  });
  if (!machine) return NextResponse.json({ error: "Fascicolo non trovato" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  if (String(b?.code ?? "").trim().toUpperCase() !== machine.code.toUpperCase())
    return NextResponse.json(
      { error: `Per eliminare, riscrivi il codice del fascicolo (${machine.code})` },
      { status: 400 }
    );

  // Le foto scattate su un INTERVENTO restano all'intervento: sono la prova di
  // un lavoro fatto in cantiere, non del fascicolo. Senza questo passaggio la
  // cascata se le porterebbe via dai rapportini e dalle chat di quel cantiere.
  await prisma.photo.updateMany({
    where: { machineId: id, interventoId: { not: null } },
    data: { machineId: null },
  });

  // i file su disco delle righe che stanno per sparire (le altre non si toccano)
  const [photos, docs] = await Promise.all([
    prisma.photo.findMany({ where: { machineId: id }, select: { path: true } }),
    prisma.document.findMany({ where: { machineId: id }, select: { path: true } }),
  ]);
  // GphotoAlbum non ha una chiave esterna verso Machine: resterebbe orfano
  await prisma.gphotoAlbum.deleteMany({ where: { machineId: id } });

  // Gli interventi di service restano (relazione SetNull): il cantiere c'e'
  // stato anche se il fascicolo era sbagliato.
  await prisma.machine.delete({ where: { id } });
  await deleteUploads([...photos.map((x) => x.path), ...docs.map((x) => x.path)]);
  await removeScopeIfEmpty(machine.code);

  console.log(
    `[macchine] ${user.name} ha eliminato il fascicolo ${machine.code} (job ${machine.job}, ${machine.customer})`
  );
  return NextResponse.json({ ok: true, code: machine.code });
}
