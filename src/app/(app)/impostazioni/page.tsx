import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlantConfig, getPermissions, getNavVisibility, getAppAccess } from "@/lib/settings";
import { can } from "@/lib/permissions";
import { isGoogleConfigured, getUserGoogleInfo, getCompanyGoogleInfo } from "@/lib/google";
import {
  getRapportinoMailConfig,
  getRapportinoMailState,
  pendingRapportini,
} from "@/lib/rapportinoMail";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const perms = await getPermissions();
  if (!can(user.role, "settings.manage", perms)) redirect("/dashboard");
  const [plantConfig, navVisibility, appAccess, googleMe, googleCompany, usage] = await Promise.all([
    getPlantConfig(),
    getNavVisibility(),
    getAppAccess(),
    getUserGoogleInfo(user.id),
    getCompanyGoogleInfo(),
    // Modelli effettivamente usati dai fascicoli: servono a riallineare quelli
    // rinominati o tolti dalla configurazione.
    prisma.machine.groupBy({ by: ["plantType", "model"], _count: { _all: true } }),
  ]);
  // invio automatico dei rapportini: config, esito ultimo giro e quanti aspettano
  const rapportinoMail = await getRapportinoMailConfig();
  const [rapportinoMailState, pending] = await Promise.all([
    getRapportinoMailState(),
    pendingRapportini(rapportinoMail),
  ]);
  const modelUsage = usage
    .filter((u) => u.plantType)
    .map((u) => ({ plantType: u.plantType as string, model: u.model, count: u._count._all }));
  const canSync = can(user.role, "machine.import", perms);
  const erpConfigured = Boolean(process.env.SQLSERVER_HOST && process.env.SQLSERVER_USER);
  return (
    <SettingsClient
      plantConfig={plantConfig}
      modelUsage={modelUsage}
      permissions={perms}
      navVisibility={navVisibility}
      appAccess={appAccess}
      canSync={canSync}
      erpConfigured={erpConfigured}
      googleConfigured={isGoogleConfigured()}
      googleMe={googleMe}
      googleCompany={googleCompany}
      currentUserEmail={user.email}
      rapportinoMail={rapportinoMail}
      rapportinoMailState={rapportinoMailState}
      rapportinoMailPending={pending.length}
    />
  );
}
