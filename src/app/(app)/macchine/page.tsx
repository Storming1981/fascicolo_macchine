import { prisma } from "@/lib/db";
import { userCaps } from "@/lib/caps";
import { progressForMachines } from "@/lib/progressService";
import { defaultTipo, machineSheetKinds, SHAFT_DOC_CATEGORIES } from "@/lib/allestimento";
import { collaudoAlert, sheetsAlert, sheetsScope, shaftDocsAlert, SIGN_ROLES } from "@/lib/machineAlerts";
import { ORDER_FIELDS, orderRef } from "@/lib/orderRef";
import { mainOrderRole } from "@/lib/plant";
import MachinesList from "./MachinesList";

export const dynamic = "force-dynamic";

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const caps = await userCaps("machine.create", "machine.import");
  const machines = await prisma.machine.findMany({ orderBy: [{ year: "desc" }, { createdAt: "desc" }] });
  const progress = await progressForMachines(machines);
  // Schede di allestimento, collaudo e firme: tre query per tutta la pagina,
  // non una per riga. Dalle schede esce sia il tipo container (intestazione
  // della M5.17) sia quali sono firmate.
  const ids = machines.map((m) => m.id);
  const [sheets, collaudi, firme, shaftDocs] = await Promise.all([
    prisma.allestimentoSheet.findMany({
      where: { machineId: { in: ids } },
      select: { machineId: true, kind: true, status: true, header: true },
    }),
    prisma.collaudo.findMany({
      where: { machineId: { in: ids } },
      select: { machineId: true, status: true },
    }),
    // le firme legate a un evento di diario sono quelle degli interventi:
    // le tre in calce al collaudo non ne hanno
    prisma.signature.findMany({
      where: { machineId: { in: ids }, diaryEventId: null, role: { in: [...SIGN_ROLES] } },
      select: { machineId: true, role: true },
    }),
    // Documenti dell'albero: una query per tutta la pagina, non una per riga.
    prisma.document.findMany({
      where: { machineId: { in: ids }, category: { in: SHAFT_DOC_CATEGORIES } },
      select: { machineId: true, category: true },
    }),
  ]);

  const tipoByMachine = new Map(
    sheets
      .filter((s) => s.kind === "CONTAINER")
      .map((s) => [s.machineId, ((s.header as { tipo?: string } | null)?.tipo ?? "").trim()])
  );
  const signedSheets = new Map<string, Set<string>>();
  for (const s of sheets) {
    if (s.status !== "SIGNED") continue;
    const set = signedSheets.get(s.machineId) ?? new Set<string>();
    set.add(s.kind);
    signedSheets.set(s.machineId, set);
  }
  const collaudoByMachine = new Map(collaudi.map((c) => [c.machineId, c.status as string]));
  const rolesByMachine = new Map<string, Set<string>>();
  for (const f of firme) {
    const set = rolesByMachine.get(f.machineId) ?? new Set<string>();
    set.add(f.role);
    rolesByMachine.set(f.machineId, set);
  }
  // Ordini di produzione del fascicolo: una query sola per la pagina, con
  // l'articolo principale preso dal catalogo che porta il sync-agent. Servono
  // nell'elenco perche' una macchina la si cerca anche per numero d'ordine, e
  // per saperlo si doveva aprire il fascicolo.
  const orderKeys = [
    ...new Set(
      machines.flatMap((m) => ORDER_FIELDS.map((f) => m[f.field]).filter((k): k is string => !!k))
    ),
  ];
  const erpOrders = orderKeys.length
    ? await prisma.erpCommessaOrder.findMany({
        where: { key: { in: orderKeys } },
        select: { key: true, mainArticleCode: true, mainArticleDesc: true, hours: true },
        // stessa chiave su piu' commesse: vince quella con l'avanzamento
        orderBy: { hours: "desc" },
      })
    : [];
  const orderInfo = new Map<string, { desc: string | null; hours: number }>();
  for (const o of erpOrders)
    if (!orderInfo.has(o.key))
      orderInfo.set(o.key, { desc: o.mainArticleDesc || o.mainArticleCode, hours: o.hours });

  const shaftByMachine = new Map<string, Set<string>>();
  for (const d of shaftDocs) {
    const set = shaftByMachine.get(d.machineId) ?? new Set<string>();
    set.add(d.category);
    shaftByMachine.set(d.machineId, set);
  }
  const empty = new Set<string>();
  const data = machines.map((m) => ({
    id: m.id,
    code: m.code,
    job: m.job,
    plantType: m.plantType,
    model: m.model,
    customer: m.customer,
    country: m.country,
    countryCode: m.countryCode,
    year: m.year,
    status: m.status,
    progress: progress.get(m.id)?.percent ?? 0,
    // senza scheda il tipo non e' stato scelto: si mostra il default del
    // modello solo quando la scheda esiste, altrimenti sarebbe un dato inventato
    containerType: tipoByMachine.has(m.id)
      ? tipoByMachine.get(m.id) || defaultTipo("CONTAINER", m.model)
      : null,
    tiranteGiunto: m.tiranteGiunto,
    filtroMaggiorato: m.filtroMaggiorato,
    // Schede che la commessa comprende davvero: le caselle dei kit seguono
    // queste (solo container -> niente tirante giunto, che sta sulla M5.16).
    sheetKinds: machineSheetKinds(m.plantType, m.sheetKinds),
    scope: sheetsScope(m.plantType, m.sheetKinds),
    orders: ORDER_FIELDS.flatMap(({ field, role }) => {
      const ref = orderRef(m[field]);
      if (!ref) return [];
      const info = orderInfo.get(m[field]!);
      return [
        {
          role: role === "Corpo" ? mainOrderRole(m.plantType) : role,
          ref,
          desc: info?.desc ?? null,
          hours: info?.hours ?? null,
        },
      ];
    }),
    schede: sheetsAlert(m.plantType, signedSheets.get(m.id) ?? empty, m.sheetKinds),
    docAlberi: shaftDocsAlert(m.plantType, m.sheetKinds, shaftByMachine.get(m.id) ?? empty),
    collaudo: collaudoAlert(
      m.plantType,
      collaudoByMachine.get(m.id) ?? null,
      rolesByMachine.get(m.id) ?? empty,
      m.sheetKinds
    ),
  }));
  return (
    <MachinesList
      key={q || "all"}
      machines={data}
      canCreate={caps["machine.create"]}
      canImport={caps["machine.import"]}
      initialQuery={q || ""}
    />
  );
}
