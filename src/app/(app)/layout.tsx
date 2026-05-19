import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/domain";
import { getPermissions } from "@/lib/settings";
import { can } from "@/lib/permissions";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const machineCount = await prisma.machine.count();
  const perms = await getPermissions();

  return (
    <AppShell
      user={{ name: user.name, roleLabel: ROLE_LABEL[user.role], email: user.email }}
      machineCount={machineCount}
      caps={{
        import: can(user.role, "machine.import", perms),
        settings: can(user.role, "settings.manage", perms),
      }}
    >
      {children}
    </AppShell>
  );
}
