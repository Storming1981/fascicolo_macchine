import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveShell } from "@/lib/shell";

export const dynamic = "force-dynamic";

/**
 * Scorciatoia verso la chat di una conversazione, **senza sapere da dove si
 * arriva**.
 *
 * La notifica di un messaggio finisce sulla campanella, in una mail e in un
 * push, e il push può portare un solo indirizzo: ma la chat del desktop e
 * quella dell'app Campo sono due pagine diverse, e un tecnico di cantiere su
 * `/service/chat` verrebbe rimbalzato al suo guscio perdendo la conversazione.
 * Qui si decide una volta sola, lato server, e si manda ognuno dove sa
 * rispondere.
 */
export default async function VaiInChat({ params }: { params: Promise<{ conv: string }> }) {
  const user = await currentUser();
  const { conv } = await params;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/vai/chat/${conv}`)}`);
  if (user.role === "CLIENTE") redirect("/portale");

  const c = await prisma.conversation.findUnique({
    where: { id: conv },
    select: { id: true, interventoId: true },
  });
  if (!c) redirect("/service/chat");

  const { target } = await resolveShell(user);
  if (target === "campo" && c.interventoId) redirect(`/campo/interventi/${c.interventoId}/chat`);
  redirect(`/service/chat?conv=${c.id}`);
}
