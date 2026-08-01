import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { loadInterventoDetail } from "@/lib/interventoDetailLoader";
import { isGoogleConfigured, resolveSenderEmail } from "@/lib/google";
import InterventoDetail from "./InterventoDetail";

export const dynamic = "force-dynamic";

export default async function InterventoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");
  const { id } = await params;

  const data = await loadInterventoDetail(id);
  if (!data) notFound();

  // Tecnico di campo (senza viewAll): può aprire solo i propri interventi.
  const canViewAll = await userCan(user.role, "intervento.viewAll");
  if (!canViewAll) {
    const onTeam =
      data.dto.techId === user.id || data.dto.participants.some((p) => p.id === user.id);
    if (!onTeam) redirect("/service/interventi");
  }

  const canEdit = await userCan(user.role, "intervento.edit");
  const canSign = await userCan(user.role, "intervento.sign");
  const canChecklist = await userCan(user.role, "checklist.manage");
  const googleConfigured = isGoogleConfigured();
  const googleSender = googleConfigured ? await resolveSenderEmail(user.id) : null;

  return (
    <InterventoDetail
      data={data.dto}
      techs={data.techs}
      machines={data.machines}
      commesse={data.commesse}
      currentUserName={user.name}
      canEdit={canEdit}
      canSign={canSign}
      canChecklist={canChecklist}
      googleConfigured={googleConfigured}
      googleSender={googleSender}
    />
  );
}
