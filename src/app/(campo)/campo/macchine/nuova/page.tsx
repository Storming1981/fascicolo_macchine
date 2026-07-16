import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { getPlantConfig, userCan } from "@/lib/settings";
import Icon from "@/components/Icon";
import NewMachineForm from "@/app/(app)/macchine/nuova/NewMachineForm";

export const dynamic = "force-dynamic";

export default async function CampoNuovaMacchinaPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "machine.create"))) redirect("/campo/macchine");
  const plantConfig = await getPlantConfig();

  return (
    <div>
      <Link href="/campo/macchine" className="campo-back">
        <Icon name="arrow-left" size={16} /> Fascicolo
      </Link>
      <NewMachineForm plantConfig={plantConfig} redirectBase="/campo/macchine" />
    </div>
  );
}
