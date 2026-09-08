import "server-only";
import { prisma } from "./db";
import { POS_CATEGORY } from "./domain";
import type { InterventoStatus, User } from "@prisma/client";

/**
 * P.O.S. — Piano Operativo di Sicurezza.
 *
 * Regola di processo: un intervento nasce in stato `DOCUMENTAZIONE`. Prima di
 * poterlo assegnare a un tecnico o pianificarlo bisogna
 *   1. caricare il file del P.O.S. nella sezione Documenti (category = "pos");
 *   2. farlo validare dal responsabile (flag + firma) — di norma l'utente con
 *      `posValidator` in anagrafica (es. Fausto Zanotti), oltre agli ADMIN.
 * Solo allora l'intervento passa a "Nuovo" e diventa pianificabile.
 * Gli altri documenti restano liberi: si caricano a mano senza vincoli.
 */

/** Chi può mettere il flag e la firma sul P.O.S. */
export function canValidatePos(
  user: Pick<User, "role" | "posValidator"> | null | undefined
): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || user.posValidator === true;
}

/** C'è un file P.O.S. caricato per questo intervento? */
export async function hasPosDocument(interventoId: string): Promise<boolean> {
  const n = await prisma.interventoDocument.count({
    where: { interventoId, category: POS_CATEGORY },
  });
  return n > 0;
}

/** Campi della PATCH che equivalgono ad assegnare o pianificare l'intervento. */
export function touchesPlanning(b: Record<string, unknown>): boolean {
  if (typeof b.assignedTechId === "string" && b.assignedTechId) return true;
  if (b.scheduledStart) return true;
  if (b.scheduledEnd) return true;
  if (Array.isArray(b.participantIds) && b.participantIds.length > 0) return true;
  return false;
}

export const POS_BLOCK_MESSAGE =
  "P.O.S. non validato: carica il Piano Operativo di Sicurezza e fallo validare dal responsabile prima di assegnare o pianificare l'intervento.";

/**
 * Motivo per cui l'intervento non è ancora pianificabile (null = via libera).
 * `status` serve solo a spiegare meglio: il vincolo è `posValidated`.
 */
export function posBlockReason(intervento: {
  posValidated: boolean;
  status: InterventoStatus;
}): string | null {
  return intervento.posValidated ? null : POS_BLOCK_MESSAGE;
}
