import "server-only";
import { currentUser } from "./auth";
import { getPermissions } from "./settings";
import { can, type PermAction } from "./permissions";

/** Capability dell'utente corrente per le azioni indicate. */
export async function userCaps<A extends PermAction>(
  ...actions: A[]
): Promise<Record<A, boolean>> {
  const user = await currentUser();
  const perms = await getPermissions();
  const out = {} as Record<A, boolean>;
  for (const a of actions) out[a] = user ? can(user.role, a, perms) : false;
  return out;
}
