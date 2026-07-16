import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPlantConfig, getPermissions, getNavVisibility, getAppAccess } from "@/lib/settings";
import { can } from "@/lib/permissions";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const perms = await getPermissions();
  if (!can(user.role, "settings.manage", perms)) redirect("/dashboard");
  const [plantConfig, navVisibility, appAccess] = await Promise.all([
    getPlantConfig(),
    getNavVisibility(),
    getAppAccess(),
  ]);
  const canSync = can(user.role, "machine.import", perms);
  const erpConfigured = Boolean(process.env.SQLSERVER_HOST && process.env.SQLSERVER_USER);
  return (
    <SettingsClient
      plantConfig={plantConfig}
      permissions={perms}
      navVisibility={navVisibility}
      appAccess={appAccess}
      canSync={canSync}
      erpConfigured={erpConfigured}
    />
  );
}
