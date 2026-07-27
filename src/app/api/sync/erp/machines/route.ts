import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync/erp/machines
 *
 * Elenco dei fascicoli con le chiavi che servono al sync-agent per interrogare
 * il gestionale (job di vendita, corpo, container, ordini di produzione).
 * Autenticazione: `Authorization: Bearer sk_sync_...` (SYNC_API_KEY).
 *
 * Il sync-agent chiama questo endpoint per sapere COSA interrogare, esegue le
 * query su SQL Server in azienda e rimanda i risultati a POST /api/sync/erp.
 */
export async function GET(req: Request) {
  if (!isSyncConfigured())
    return NextResponse.json({ error: "Sync non configurato" }, { status: 503 });
  if (!isValidSyncRequest(req))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const machines = await prisma.machine.findMany({
    select: {
      id: true,
      code: true,
      job: true,
      jobBody: true,
      jobContainer: true,
      erpBodyOrder: true,
      erpContainerOrder: true,
      erpStandOrder: true,
      erpBladesOrder: true,
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json({ count: machines.length, machines });
}
