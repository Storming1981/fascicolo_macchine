import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCommessaOrders, isErpConfigured } from "@/lib/erp";

/**
 * GET /api/erp/commessa/[commeca]/orders
 * Elenco degli ordini di produzione (tipork 'H') della commessa, con articolo
 * principale, ore e date. Alimenta la tendina di selezione ordine nel fascicolo.
 * Senza ERP diretto (VPS) legge la copia sincronizzata (ErpCommessaOrder).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ commeca: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { commeca } = await ctx.params;

  if (!isErpConfigured()) {
    const commessa = Number(String(commeca).trim());
    if (!Number.isFinite(commessa)) return NextResponse.json({ commeca, orders: [] });
    const rows = await prisma.erpCommessaOrder.findMany({
      where: { commessa },
      orderBy: [{ anno: "desc" }, { num: "desc" }],
    });
    const orders = rows.map((o) => ({
      key: o.key,
      tipork: o.tipork,
      anno: o.anno,
      serie: o.serie,
      num: o.num,
      mainArticleCode: o.mainArticleCode,
      mainArticleDesc: o.mainArticleDesc,
      hours: o.hours,
      start: o.start ? o.start.toISOString() : null,
      end: o.end ? o.end.toISOString() : null,
      rows: o.rows,
      articleCount: o.articleCount,
    }));
    return NextResponse.json({ commeca, orders });
  }

  try {
    const orders = await getCommessaOrders(commeca);
    return NextResponse.json({ commeca, orders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore gestionale";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
