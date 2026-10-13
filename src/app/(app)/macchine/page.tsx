import { prisma } from "@/lib/db";
import { userCaps } from "@/lib/caps";
import { progressForMachines } from "@/lib/progressService";
import { defaultTipo } from "@/lib/allestimento";
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
  // Tipo container (E, E UL, Stage V…): sta nell'intestazione della scheda
  // M5.17, una query sola per tutta la pagina.
  const sheets = await prisma.allestimentoSheet.findMany({
    where: { kind: "CONTAINER", machineId: { in: machines.map((m) => m.id) } },
    select: { machineId: true, header: true },
  });
  const tipoByMachine = new Map(
    sheets.map((s) => [s.machineId, ((s.header as { tipo?: string } | null)?.tipo ?? "").trim()])
  );
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
