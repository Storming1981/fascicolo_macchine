import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import CampoChat from "./CampoChat";

export const dynamic = "force-dynamic";

export default async function CampoInterventoChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/campo/macchine");
  const { id } = await params;

  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      title: true,
      deletedAt: true,
      assignedTechId: true,
      participants: { select: { id: true } },
      conversations: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
    },
  });
  if (!intervento || intervento.deletedAt) notFound();

  // Tecnico senza viewAll: solo se in squadra
  const canViewAll = await userCan(user.role, "intervento.viewAll");
  if (!canViewAll) {
    const onTeam =
      intervento.assignedTechId === user.id || intervento.participants.some((p) => p.id === user.id);
    if (!onTeam) redirect("/campo/interventi");
  }

  const canSend = await userCan(user.role, "chat.send");
  const convId = intervento.conversations[0]?.id ?? null;

  return (
    <CampoChat
      interventoId={intervento.id}
      code={intervento.code}
      title={intervento.title}
      convId={convId}
      canSend={canSend}
    />
  );
}
