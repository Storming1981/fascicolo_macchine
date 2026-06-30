import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { getMachineErpData, isErpConfigured } from "@/lib/erp";
import { syncMachine } from "@/lib/erpSync";

/**
 * GET  /api/machines/[id]/erp-sync  → anteprima (dry-run): dati ERP per i job
 *                                      della macchina, senza scrivere nulla.
 * POST /api/machines/[id]/erp-sync  → sincronizza il fascicolo dal gestionale:
 *                                      cliente+paese, descrizione, ore, inizio/
 *                                      fine produzione (MachineMilestone
 *                                      source GESTIONALE).
 */

async function loadMachineAndErp(id: string) {
  const machine = await prisma.machine.findUnique({
    where: { id },
    select: {
      id: true,
      job: true,
      jobBody: true,
      jobContainer: true,
      erpBodyOrder: true,
      erpContainerOrder: true,
      erpStandOrder: true,
      erpBladesOrder: true,
    },
  });
  if (!machine) return null;
  const erp = await getMachineErpData({
    job: machine.job,
    jobBody: machine.jobBody,
    jobContainer: machine.jobContainer,
    bodyOrder: machine.erpBodyOrder,
    containerOrder: machine.erpContainerOrder,
    standOrder: machine.erpStandOrder,
    bladesOrder: machine.erpBladesOrder,
  });
  return { machine, erp };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato" }, { status: 503 });

  const { id } = await ctx.params;
  try {
    const res = await loadMachineAndErp(id);
    if (!res) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });
    return NextResponse.json(res.erp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore gestionale";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato" }, { status: 503 });

  const { id } = await ctx.params;

  try {
    const result = await syncMachine(id);
    if (!result.found)
      return NextResponse.json(
        { error: "Nessuna commessa trovata nel gestionale per i job di questo fascicolo" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true, changed: result.changed, erp: result.erp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore gestionale";
    const status = msg === "Macchina non trovata" ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
