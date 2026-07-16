import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { loadMachineDetailProps } from "@/lib/machineDetailLoader";
import Icon from "@/components/Icon";
import MachineDetail from "@/app/(app)/macchine/[code]/MachineDetail";

export const dynamic = "force-dynamic";

export default async function CampoMachinePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const canMachine =
    (await userCan(user.role, "machine.intervention")) || (await userCan(user.role, "machine.edit"));
  if (!canMachine) redirect("/campo/interventi");

  const { code } = await params;
  const props = await loadMachineDetailProps(code);
  if (!props) notFound();

  // Nell'app Fascicolo la scheda Service (interventi/chat) è gestita dall'app
  // Interventi: nascondi quel tab per evitare rimandi al guscio desktop.
  const caps = { ...props.caps, service: false };

  return (
    <div className="campo-machine">
      <Link href="/campo/macchine" className="campo-back">
        <Icon name="arrow-left" size={16} /> Cerca macchina
      </Link>
      <MachineDetail {...props} caps={caps} />
    </div>
  );
}
