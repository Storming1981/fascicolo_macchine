import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync/erp/orders
 *
 * Riceve dal sync-agent l'elenco ordini di produzione di una commessa (tipork
 * 'H', da avlavp) e sostituisce quelli salvati per quella commessa. Serve alle
 * tendine "Ordine Corpo/Container" degli impianti nuovi (commessa 999999999)
 * quando la VPS non ha connessione diretta al gestionale.
 *
 * Body: { commessa: number, orders: Array<{ key, tipork, anno, serie, num,
 *   mainArticleCode?, mainArticleDesc?, hours, start?, end?, rows, articleCount }> }
 * Autenticazione: Bearer sk_sync_ (SYNC_API_KEY).
 */
export async function POST(req: Request) {
  if (!isSyncConfigured())
    return NextResponse.json({ error: "Sync non configurato" }, { status: 503 });
  if (!isValidSyncRequest(req))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  let body: { commessa?: unknown; orders?: unknown[] } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const commessa = typeof body?.commessa === "number" ? body.commessa : Number(body?.commessa);
  if (!Number.isFinite(commessa) || !Array.isArray(body?.orders))
    return NextResponse.json({ error: "commessa/orders mancanti" }, { status: 400 });

  const toDate = (v: unknown) => {
    if (typeof v !== "string" || !v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

  const rows = (body.orders as Record<string, unknown>[])
    .filter((o) => typeof o?.key === "string")
    .map((o) => ({
      commessa,
      key: String(o.key),
      tipork: s(o.tipork) ?? "",
      anno: n(o.anno),
      serie: s(o.serie) ?? "",
      num: n(o.num),
      mainArticleCode: s(o.mainArticleCode),
      mainArticleDesc: s(o.mainArticleDesc),
      hours: n(o.hours),
      start: toDate(o.start),
      end: toDate(o.end),
      rows: n(o.rows),
      articleCount: n(o.articleCount),
    }));

  // replace: cancella gli ordini della commessa e reinserisce
  await prisma.erpCommessaOrder.deleteMany({ where: { commessa } });
  if (rows.length) await prisma.erpCommessaOrder.createMany({ data: rows, skipDuplicates: true });

  return NextResponse.json({ status: "success", count: rows.length });
}
