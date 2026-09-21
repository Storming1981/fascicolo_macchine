import { prisma } from "./db";

/**
 * Prese in carico di un intervento.
 *
 * Il responsabile pianifica, ma finché gli assegnati non rispondono non sa se
 * ci saranno davvero: una riga `InterventoAck` per ogni persona coinvolta,
 * in attesa finché non preme Accetta (o Non posso).
 */

export type AckRole = "lead" | "member";

/**
 * Su un intervento gia' partito non si chiede di accettare: la squadra e' gia'
 * in cantiere, e chiedere "confermi che ci sarai?" a chi ci sta lavorando da
 * settimane e' solo un richiamo rosso da togliersi di torno. Le righe si creano
 * comunque, ma nascono gia' accettate, cosi' il quadro resta completo.
 */
const STARTED: string[] = ["IN_CORSO", "COMPLETATO", "FATTURATO"];

export function needsAcceptance(status: string): boolean {
  return !STARTED.includes(status);
}

/**
 * Allinea le righe di presa in carico alla squadra attuale.
 *
 * - chi esce dalla squadra: la riga sparisce;
 * - chi entra: riga nuova, in attesa;
 * - chi **cambia ruolo** (da squadra a capo cantiere) torna in attesa: accettare
 *   di partecipare non è accettare di guidare il cantiere;
 * - chi resta con lo stesso ruolo **tiene la sua risposta**, altrimenti ogni
 *   salvataggio della scheda azzererebbe le accettazioni già raccolte.
 *
 * `datesChanged` azzera tutte le risposte: chi aveva accettato dal 12 al 16 non
 * ha accettato dal 20 al 24, e il responsabile deve risapere se ci sono.
 *
 * Ritorna gli id di chi è tornato (o andato) in attesa: sono quelli a cui va
 * mandata la notifica da accettare.
 */
export async function syncAcks(
  interventoId: string,
  leadId: string | null,
  participantIds: string[],
  actor: { id: string; name: string },
  datesChanged = false,
  status = "NUOVO"
): Promise<string[]> {
  // Cantiere gia' partito: niente da confermare, le righe nascono accettate.
  const ask = needsAcceptance(status);
  const desired = new Map<string, AckRole>();
  if (leadId) desired.set(leadId, "lead");
  for (const id of participantIds) if (!desired.has(id)) desired.set(id, "member");

  const existing = await prisma.interventoAck.findMany({ where: { interventoId } });
  const byUser = new Map(existing.map((r) => [r.userId, r]));

  // Fuori chi non fa più parte della squadra.
  const gone = existing.filter((r) => !desired.has(r.userId)).map((r) => r.id);
  if (gone.length) await prisma.interventoAck.deleteMany({ where: { id: { in: gone } } });

  const toNotify: string[] = [];
  for (const [userId, role] of desired) {
    const row = byUser.get(userId);
    const now = new Date();
    const pendingData = {
      role,
      assignedAt: now,
      assignedById: actor.id,
      assignedByName: actor.name,
      acceptedAt: ask ? null : now,
      declinedAt: null,
      note: null,
    };
    if (!row) {
      await prisma.interventoAck.create({ data: { interventoId, userId, ...pendingData } });
      if (ask) toNotify.push(userId);
      continue;
    }
    if (!ask) continue; // cantiere partito: non si riapre una risposta gia' data
    const roleChanged = row.role !== role;
    if (roleChanged || datesChanged) {
      await prisma.interventoAck.update({ where: { id: row.id }, data: pendingData });
      toNotify.push(userId);
    }
  }
  return toNotify;
}

export type AckRow = {
  userId: string;
  name: string;
  role: AckRole;
  state: "accettato" | "rifiutato" | "in attesa";
  at: string | null;
  note: string | null;
};

/** Quadro della squadra, per la scheda intervento. */
export async function listAcks(interventoId: string): Promise<AckRow[]> {
  const rows = await prisma.interventoAck.findMany({
    where: { interventoId },
    include: { user: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { assignedAt: "asc" }],
  });
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    role: r.role as AckRole,
    state: r.acceptedAt ? "accettato" : r.declinedAt ? "rifiutato" : "in attesa",
    at: (r.acceptedAt ?? r.declinedAt)?.toISOString() ?? null,
    note: r.note,
  }));
}
