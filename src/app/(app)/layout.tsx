import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/domain";
import { getPermissions, getNavVisibility } from "@/lib/settings";
import { can } from "@/lib/permissions";
import { NAV_KEYS, navVisible, type NavKey } from "@/lib/nav";
import { resolveShell } from "@/lib/shell";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Gli utenti cliente non entrano nell'app operatori: solo portale.
  if (user.role === "CLIENTE") redirect("/portale");

  // Guscio: gli operativi (e i responsabili su tablet/telefono) vanno all'app Campo.
  const { access, target } = await resolveShell(user);
  if (target === "campo") redirect("/campo");

  const machineCount = await prisma.machine.count();
  const [perms, navMatrix] = await Promise.all([getPermissions(), getNavVisibility()]);

  const nav = Object.fromEntries(
    NAV_KEYS.map((k) => [k, navVisible(user.role, k, navMatrix)])
  ) as Record<NavKey, boolean>;

  return (
    <AppShell
      user={{ name: user.name, roleLabel: ROLE_LABEL[user.role], email: user.email }}
      machineCount={machineCount}
      nav={nav}
      canCampo={access.campoApps.length > 0}
      caps={{
        import: can(user.role, "machine.import", perms),
        settings: can(user.role, "settings.manage", perms),
        service: can(user.role, "service.view", perms),
      }}
    >
      {children}
    </AppShell>
  );
}
