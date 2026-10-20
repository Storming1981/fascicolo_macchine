import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/domain";
import { getPermissions } from "@/lib/settings";
import { can } from "@/lib/permissions";
import PeopleClient from "./PeopleClient";
import type { ExternalSignerRow } from "@/lib/externalSigners";

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
      matricola: u.matricola,
      badgeId: u.badgeId,
      zona: u.zona,
      phone: u.phone,
      photo: u.photo,
      reparto: u.reparto,
      siteManager: u.siteManager,
      posValidator: u.posValidator,
      viewerChat: u.viewerChat,
      company: u.company,
      appAccess: u.appAccess,
      signs: c?._count._all ?? 0,
      last: c?._max.signedAt ? c._max.signedAt.toISOString() : null,
    };
  });

  // Persone esterne senza account che possono firmare (es. approvazione collaudo)
  const ext = await prisma.externalSigner.findMany({
    orderBy: [{ company: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    include: {
      _count: { select: { collaudi: true } },
      account: { select: { email: true, active: true } },
    },
  });
  const externals: ExternalSignerRow[] = ext.map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    company: e.company,
    jobTitle: e.jobTitle,
    email: e.email,
    phone: e.phone,
    notes: e.notes,
    active: e.active,
    signs: e._count.collaudi,
    account: e.account,
  }));

  return <PeopleClient users={data} externals={externals} isAdmin={canManage} />;
}
