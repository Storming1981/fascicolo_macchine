import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPlantConfig, getPermissions } from "@/lib/settings";
import { can } from "@/lib/permissions";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const perms = await getPermissions();
  if (!can(user.role, "settings.manage", perms)) redirect("/dashboard");
  const plantConfig = await getPlantConfig();
  const canSync = can(user.role, "machine.import", perms);
  const erpConfigured = Boolean(process.env.SQLSERVER_HOST && process.env.SQLSERVER_USER);
  return (
    <SettingsClient
      plantConfig={plantConfig}
      permissions={perms}
      canSync={canSync}
      erpConfigured={erpConfigured}
    />
  );
}
