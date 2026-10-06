import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { machineHoursAnalysis } from "@/lib/hoursAnalysis";
import { isFeedConfigured, syncRecentStampings } from "@/lib/presenceFeed";

/**
 * GET  /api/machines/[id]/hours → analisi ore: produzione (gestionale) +
 *                                  cantiere (timbratore, copia locale).
 * POST /api/machines/[id]/hours → rilegge dal timbratore gli ultimi 14 giorni
 *                                  e restituisce l'analisi aggiornata (dove il
 *                                  timbratore non c'è, ricalcola e basta).
 *                                  Lo storico lo porta il sync orario.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { id } = await ctx.params;
  const data = await machineHoursAnalysis(id);
  if (!data) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  // È il pulsante "Aggiorna" della card: senza timbratore ricalcola comunque i
  // dati del gestionale, invece di rispondere con un errore.
  // Più persone sulla stessa scheda non devono martellare il timbratore:
  // se la copia è di meno di due minuti fa si riusa quella.
  const last = await prisma.stamping.aggregate({ _max: { syncedAt: true } });
  const fresh = last._max.syncedAt && Date.now() - last._max.syncedAt.getTime() < 2 * 60_000;
  if (isFeedConfigured() && !fresh) {
    try {
      await syncRecentStampings(14);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Timbratore non raggiungibile" },
        { status: 502 },
      );
    }
  }
  const { id } = await ctx.params;
  const data = await machineHoursAnalysis(id);
  if (!data) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });
  return NextResponse.json(data);
}
