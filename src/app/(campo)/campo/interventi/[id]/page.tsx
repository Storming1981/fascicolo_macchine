import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { loadInterventoDetail } from "@/lib/interventoDetailLoader";
import InterventoDetail from "@/app/(app)/service/interventi/[id]/InterventoDetail";

export const dynamic = "force-dynamic";

export default async function CampoInterventoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/campo/macchine");
  const { id } = await params;

  const data = await loadInterventoDetail(id);
  if (!data) notFound();

  const canViewAll = await userCan(user.role, "intervento.viewAll");
  if (!canViewAll) {
    const onTeam =
      data.dto.techId === user.id || data.dto.participants.some((p) => p.id === user.id);
    if (!onTeam) redirect("/campo/interventi");
  }

  const canEdit = await userCan(user.role, "intervento.edit");
  const canSign = await userCan(user.role, "intervento.sign");

  return (
    <InterventoDetail
      data={data.dto}
      techs={data.techs}
      machines={data.machines}
      commesse={data.commesse}
      currentUserName={user.name}
      canEdit={canEdit}
      canSign={canSign}
      canChecklist={false}
      campo
      backHref="/campo/interventi"
      machineBase="/campo/macchine"
    />
  );
}
