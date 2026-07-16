import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { resolveShell } from "@/lib/shell";
import CampoShell from "@/components/CampoShell";

export const dynamic = "force-dynamic";

export default async function CampoLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { access } = await resolveShell(user);
  // Nessuna app campo disponibile → torna al desktop.
  if (access.campoApps.length === 0) redirect("/dashboard");

  return (
    <CampoShell
      user={{ name: user.name, email: user.email }}
      apps={access.campoApps}
      canDesktop={access.desktop}
    >
      {children}
    </CampoShell>
  );
}
