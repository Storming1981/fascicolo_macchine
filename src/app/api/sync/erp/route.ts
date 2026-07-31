import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";
import { applyErpData, type AppliedErpData, type SyncOptions } from "@/lib/erpSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync/erp
 *
 * Riceve dal sync-agent i dati ERP già calcolati per una lista di fascicoli e
 * li scrive nel DB (cliente, paese, descrizione, ore, date di produzione +
 * milestone). È la controparte "write" di erpSync.ts quando l'app non può
 * interrogare direttamente il gestionale (deploy su VPS).
 *
 * Body:
 *   {
 *     agentInfo?: string,
 *     options?: { customer, production, description, hours },
 *     results: Array<{
 *       id: string,                       // Machine.id
 *       found: boolean,
 *       customer?: string|null,
 *       customerCountryIso?: string|null,
 *       customerCountryName?: string|null,
 *       description?: string|null,
 *       totalHours?: number|null,
 *       productionStart?: string|null,    // ISO
 *       productionEnd?: string|null       // ISO
 *     }>
 *   }
 *
 * Autenticazione: `Authorization: Bearer sk_sync_...` (SYNC_API_KEY).
 */

type IncomingResult = AppliedErpData & { id?: unknown; customerConto?: number | null };

export async function POST(req: Request) {
  const startedAt = Date.now();

  if (!isSyncConfigured())
    return NextResponse.json({ error: "Sync non configurato" }, { status: 503 });
  if (!isValidSyncRequest(req))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  let body: {
    results?: IncomingResult[];
    options?: SyncOptions;
    agentInfo?: string;
  } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.results))
    return NextResponse.json({ error: "Campo 'results' mancante" }, { status: 400 });

  const options = body.options;
  let matched = 0;
  let updated = 0;
  let withProduction = 0;
  let linked = 0;
  const errors: { id: string; error: string }[] = [];

  for (const r of body.results) {
    const id = typeof r?.id === "string" ? r.id : null;
    if (!id) {
      errors.push({ id: String(r?.id ?? "?"), error: "id mancante o non valido" });
      continue;
    }
    if (!r.found) continue;
    matched++;
    try {
      const changed = await applyErpData(
        id,
        {
          found: true,
          customer: r.customer ?? null,
          customerCountryIso: r.customerCountryIso ?? null,
          customerCountryName: r.customerCountryName ?? null,
          description: r.description ?? null,
          totalHours: r.totalHours ?? null,
          productionStart: r.productionStart ?? null,
          productionEnd: r.productionEnd ?? null,
        },
        options,
      );
      if (changed.length > 0) updated++;
      if (r.productionStart || r.productionEnd) withProduction++;

      // Collega il fascicolo al Customer del modulo Service (per erpConto), così
      // nel "Nuovo intervento" le macchine del cliente compaiono aggiornate.
      if (r.customerConto) {
        const cust = await prisma.customer.findFirst({
          where: { erpConto: r.customerConto },
          select: { id: true },
        });
        if (cust) {
          const machine = await prisma.machine.findUnique({
            where: { id },
            select: { customerId: true },
          });
          if (machine && machine.customerId !== cust.id) {
            await prisma.machine.update({ where: { id }, data: { customerId: cust.id } });
            linked++;
          }
        }
      }
    } catch (e) {
      // P2025 = record non trovato (fascicolo cancellato dopo il GET): lo saltiamo
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ id, error: msg });
    }
  }

  return NextResponse.json({
    status: errors.length === 0 ? "success" : "partial",
    agentInfo: body.agentInfo ?? null,
    results: {
      received: body.results.length,
      matched,
      updated,
      withProduction,
      linked,
      errorCount: errors.length,
    },
    errors: errors.slice(0, 50),
    durationMs: Date.now() - startedAt,
  });
}
