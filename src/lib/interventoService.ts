import "server-only";
import { prisma } from "./db";
import type { InterventoStatus } from "@prisma/client";

export const INTERVENTO_STATUSES: InterventoStatus[] = [
  "NUOVO",
  "PIANIFICATO",
  "IN_CORSO",
  "COMPLETATO",
  "FATTURATO",
];

/** Genera il prossimo codice intervento INT-NNNN (progressivo globale). */
export async function nextInterventoCode(): Promise<string> {
  const last = await prisma.intervento.findFirst({
    where: { code: { startsWith: "INT-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let n = 2000;
  if (last) {
    const parsed = parseInt(last.code.replace("INT-", ""), 10);
    if (!Number.isNaN(parsed)) n = parsed;
  }
  // garantisce univocità anche con codici non sequenziali
  for (let seq = n + 1; ; seq++) {
    const code = `INT-${seq}`;
    const exists = await prisma.intervento.findUnique({ where: { code } });
    if (!exists) return code;
  }
}

/** Stato di chiusura: per cui completedAt va valorizzato. */
export function isClosedStatus(s: InterventoStatus): boolean {
  return s === "COMPLETATO" || s === "FATTURATO";
}
