import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { resolveShell } from "@/lib/shell";

export const dynamic = "force-dynamic";

export default async function CampoHome() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { access } = await resolveShell(user);
  if (access.campoApps.includes("interventi")) redirect("/campo/interventi");
  if (access.campoApps.includes("fascicolo")) redirect("/campo/macchine");
  redirect("/dashboard");
}
