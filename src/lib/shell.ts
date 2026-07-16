import "server-only";
import { cookies, headers } from "next/headers";
import { getPermissions, getAppAccess } from "./settings";
import { resolveAccess, isMobileUserAgent, type ResolvedAccess } from "./appAccess";
import type { Role } from "@prisma/client";

export const SHELL_COOKIE = "shell";

/**
 * Decide in quale guscio deve stare l'utente (desktop | campo) tenendo conto di:
 * profilo di accesso, scelta manuale (cookie) e dispositivo (user-agent).
 */
export async function resolveShell(user: {
  role: Role;
  appAccess?: string | null;
}): Promise<{ access: ResolvedAccess; target: "desktop" | "campo" }> {
  const [perms, appMatrix, cookieStore, hdrs] = await Promise.all([
    getPermissions(),
    getAppAccess(),
    cookies(),
    headers(),
  ]);
  const access = resolveAccess(user, appMatrix, perms);

  // Operativi (solo campo): sempre campo.
  if (!access.desktop) return { access, target: "campo" };

  // Utenti desktop: scelta manuale → altrimenti dal dispositivo.
  const choice = cookieStore.get(SHELL_COOKIE)?.value;
  if (choice === "desktop") return { access, target: "desktop" };
  if (choice === "campo" && access.campoApps.length) return { access, target: "campo" };

  const mobile = isMobileUserAgent(hdrs.get("user-agent"));
  return { access, target: mobile && access.campoApps.length ? "campo" : "desktop" };
}
