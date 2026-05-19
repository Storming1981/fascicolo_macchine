import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/domain";
import { getPermissions } from "@/lib/settings";
import { can } from "@/lib/permissions";
import PeopleClient from "./PeopleClient";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const me = await currentUser();
  const perms = await getPermissions();
  const canManage = me ? can(me.role, "users.manage", perms) : false;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const counts = await prisma.signature.groupBy({
    by: ["signerId"],
    _count: { _all: true },
    _max: { signedAt: true },
  });
  const cmap = new Map(counts.map((c) => [c.signerId, c]));

  const data = users.map((u) => {
    const c = cmap.get(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      roleLabel: ROLE_LABEL[u.role],
      role: u.role,
      active: u.active,
      hasPin: !!u.pinHash,
      signs: c?._count._all ?? 0,
      last: c?._max.signedAt ? c._max.signedAt.toISOString() : null,
    };
  });

  return <PeopleClient users={data} isAdmin={canManage} />;
}
