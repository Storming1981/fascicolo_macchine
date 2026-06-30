import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getJobData, getJobFasi, isErpConfigured } from "@/lib/erp";

/**
 * GET /api/erp/job/[job]
 * Dati read-only di una commessa/job dal gestionale ZATO (SQL Server).
 * Con ?fasi=1 include anche il dettaglio delle fasi/timbrature.
 */
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato" }, { status: 503 });

  const { job } = await ctx.params;
  const wantFasi = new URL(req.url).searchParams.get("fasi") === "1";

  try {
    const data = await getJobData(job);
    if (wantFasi && data.found) {
      const fasi = await getJobFasi(job);
      return NextResponse.json({ ...data, fasi });
    }
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore gestionale";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
