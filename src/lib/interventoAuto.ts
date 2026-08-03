import { prisma } from "./db";

/**
 * Avanzamento automatico degli interventi: quando arriva il GIORNO pianificato,
 * un intervento PIANIFICATO passa a IN_CORSO (con `startedAt`).
 *
 * "Giorno pianificato" = la data di `scheduledStart` è oggi o già passata
 * (confronto sul giorno, non sull'ora). Non tocca gli interventi nel cestino.
 */
export async function autoProgressInterventi(): Promise<{ started: number }> {
  const now = new Date();
  // inizio di domani (ora locale del server = Europe/Rome): tutto ciò che è
  // pianificato fino a fine oggi rientra.
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  const res = await prisma.intervento.updateMany({
    where: {
      status: "PIANIFICATO",
      deletedAt: null,
      scheduledStart: { not: null, lt: startTomorrow },
    },
    data: { status: "IN_CORSO", startedAt: now },
  });
  return { started: res.count };
}
