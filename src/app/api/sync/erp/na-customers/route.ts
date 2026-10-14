import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync/erp/na-customers
 *
 * Copia locale dell'anagrafica clienti di **ZATO North America**
 * (`ZATONA.dbo.anagra`): la VPS non raggiunge il gestionale, e questo elenco
 * serve a compilare il cliente finale dei fascicoli destinati agli USA.
 * Sono una sessantina: si riscrive tutto l'elenco a ogni giro, senza diff.
 *
 * Body: { customers: Array<{ code, name, address?, city?, state?, zip?, country? }> }
 * Autenticazione: Bearer sk_sync_ (SYNC_API_KEY).
 */
export async function POST(req: Request) {
  if (!isSyncConfigured())
    return NextResponse.json({ error: "Sync non configurato (SYNC_API_KEY)" }, { status: 503 });
  if (!isValidSyncRequest(req)) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { customers?: unknown } | null;
  const rows = Array.isArray(body?.customers) ? body.customers : null;
  if (!rows) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const clean = rows
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      code: str(r.code, 40),
      name: str(r.name),
      address: str(r.address) || null,
      city: str(r.city, 120) || null,
      state: str(r.state, 40) || null,
      zip: str(r.zip, 20) || null,
      country: str(r.country, 40) || null,
    }))
    .filter((r) => r.code && r.name);

  for (const c of clean)
    await prisma.erpNaCustomer.upsert({ where: { code: c.code }, update: c, create: c });

  // Chi non c'e' piu' nel gestionale sparisce anche qui: un cliente cancellato
  // non deve restare selezionabile.
  const removed = clean.length
    ? await prisma.erpNaCustomer.deleteMany({ where: { code: { notIn: clean.map((c) => c.code) } } })
    : { count: 0 };

  return NextResponse.json({
    ok: true,
    upserted: clean.length,
    removed: removed.count,
    total: await prisma.erpNaCustomer.count(),
  });
}
