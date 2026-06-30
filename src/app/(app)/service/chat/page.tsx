import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import ChatClient, { type ConversationRow, type LinkOpts } from "./ChatClient";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");
  const { conv } = await searchParams;

  const canSend = await userCan(user.role, "chat.send");
  const canImport = await userCan(user.role, "chat.import");

  const [convs, customers, interventi] = await Promise.all([
    prisma.conversation.findMany({
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      include: {
        customer: { select: { name: true } },
        machine: { select: { code: true } },
        intervento: { select: { code: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        machines: { orderBy: { code: "asc" }, select: { id: true, code: true, job: true, model: true } },
      },
    }),
    prisma.intervento.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, code: true, title: true, machineId: true, customerId: true },
    }),
  ]);

  const conversations: ConversationRow[] = convs.map((c) => ({
    id: c.id,
    title: c.title,
    channel: c.channel,
    contactName: c.contactName,
    customer: c.customer?.name ?? null,
    machineCode: c.machine?.code ?? null,
    interventoCode: c.intervento?.code ?? null,
    messages: c._count.messages,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
  }));

  const links: LinkOpts = {
    customers,
    interventi,
  };

  const initialConvId = conv && conversations.some((c) => c.id === conv) ? conv : null;

  return (
    <ChatClient
      conversations={conversations}
      links={links}
      currentUserName={user.name}
      canSend={canSend}
      canImport={canImport}
      initialConvId={initialConvId}
    />
  );
}
