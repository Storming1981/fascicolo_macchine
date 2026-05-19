import { prisma } from "@/lib/db";
import { userCaps } from "@/lib/caps";
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
    progress: m.progress,
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
