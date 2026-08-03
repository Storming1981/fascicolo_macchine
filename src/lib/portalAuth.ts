import "server-only";
import { currentUser } from "./auth";
import { prisma } from "./db";

/**
 * Utente del PORTALE CLIENTE: deve avere ruolo CLIENTE e un customerId.
 * Restituisce { id, name, customerId } oppure null.
 */
export async function currentClient(): Promise<
  { id: string; name: string; customerId: string } | null
> {
  const u = await currentUser();
  if (!u || u.role !== "CLIENTE") return null;
  const full = await prisma.user.findUnique({
    where: { id: u.id },
    select: { id: true, name: true, customerId: true, active: true },
  });
  if (!full || !full.active || !full.customerId) return null;
  return { id: full.id, name: full.name, customerId: full.customerId };
}

/**
 * Verifica che una conversazione appartenga a un intervento del cliente indicato.
 * Ritorna la conversazione (id, interventoId) se autorizzata, altrimenti null.
 */
export async function clientConversation(
  conversationId: string,
  customerId: string,
): Promise<{ id: string; interventoId: string } | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, interventoId: true, intervento: { select: { customerId: true, deletedAt: true } } },
  });
  if (!conv || !conv.interventoId || !conv.intervento) return null;
  if (conv.intervento.deletedAt) return null;
  if (conv.intervento.customerId !== customerId) return null;
  return { id: conv.id, interventoId: conv.interventoId };
}
