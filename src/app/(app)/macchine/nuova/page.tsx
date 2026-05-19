import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPlantConfig, getPermissions } from "@/lib/settings";
import { can } from "@/lib/permissions";
import NewMachineForm from "./NewMachineForm";

export const dynamic = "force-dynamic";

export default async function NewMachinePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const perms = await getPermissions();
  if (!can(user.role, "machine.create", perms)) redirect("/macchine");
  const plantConfig = await getPlantConfig();
  return <NewMachineForm plantConfig={plantConfig} />;
}
