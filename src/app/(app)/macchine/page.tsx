import { prisma } from "@/lib/db";
import { userCaps } from "@/lib/caps";
import { progressForMachines } from "@/lib/progressService";
import { defaultTipo } from "@/lib/allestimento";
import { collaudoAlert, sheetsAlert, SIGN_ROLES } from "@/lib/machineAlerts";
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
  const [sheets, collaudi, firme] = await Promise.all([
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
    schede: sheetsAlert(m.plantType, signedSheets.get(m.id) ?? empty),
    collaudo: collaudoAlert(
      m.plantType,
      collaudoByMachine.get(m.id) ?? null,
      rolesByMachine.get(m.id) ?? empty
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
