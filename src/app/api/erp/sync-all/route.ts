import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isErpConfigured } from "@/lib/erp";
import { syncAllMachines, type SyncOptions } from "@/lib/erpSync";

/**
 * POST /api/erp/sync-all
 * Sincronizza in blocco tutti i fascicoli dal gestionale ZATO.
 * Richiede il permesso `machine.import` (come l'import massivo).
 * Body opzionale: { customer, production, description, hours } per limitare i campi.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.import")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato" }, { status: 503 });

  let options: SyncOptions | undefined;
  try {
    const b = await req.json();
    if (b && typeof b === "object") options = b as SyncOptions;
  } catch {
    // body assente → sincronizza tutti i campi (default)
  }

  try {
    const summary = await syncAllMachines(options);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore gestionale";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
