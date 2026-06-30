import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getCommessaOrders, isErpConfigured } from "@/lib/erp";

/**
 * GET /api/erp/commessa/[commeca]/orders
 * Elenco degli ordini di produzione (tipork 'H') della commessa, con articolo
 * principale, ore e date. Alimenta la tendina di selezione ordine nel fascicolo.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ commeca: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato" }, { status: 503 });

  const { commeca } = await ctx.params;
  try {
    const orders = await getCommessaOrders(commeca);
    return NextResponse.json({ commeca, orders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore gestionale";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
