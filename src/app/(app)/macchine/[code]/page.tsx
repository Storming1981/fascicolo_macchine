import { notFound } from "next/navigation";
import { loadMachineDetailProps } from "@/lib/machineDetailLoader";
import MachineDetail from "./MachineDetail";

export const dynamic = "force-dynamic";

export default async function MachinePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const props = await loadMachineDetailProps(code);
  if (!props) notFound();
  return <MachineDetail {...props} />;
}
