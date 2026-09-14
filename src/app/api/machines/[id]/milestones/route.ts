import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { MILESTONE_KEYS, isAutoSource } from "@/lib/milestones";
import { resolveMilestones } from "@/lib/milestoneAuto";

/**
 * Inserimento manuale delle date di stato.
 * body { items: [{ key, date: "YYYY-MM-DD" | "" }] } — solo le date cambiate.
 * Le date con valore AUTOMATICO (gestionale, check list di collaudo, intervento
 * di installazione) prevalgono e vengono ignorate qui: si correggono alla fonte.
 * Data vuota = elimina l'inserimento manuale.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, job: true, milestones: { select: { key: true, date: true, source: true } } },
  });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const effective = await resolveMilestones(machine, machine.milestones);
  const isAuto = (key: string) => isAutoSource(effective.find((m) => m.key === key)?.source);

  const b = await req.json();
  const items: { key: string; date: string }[] = Array.isArray(b.items) ? b.items : [];
  const skipped: string[] = [];

  for (const it of items) {
    if (!MILESTONE_KEYS.includes(it.key as never)) continue;
    if (isAuto(it.key)) {
      skipped.push(it.key);
      continue;
    }
    const raw = String(it.date || "").trim();
    if (!raw) {
      await prisma.machineMilestone.deleteMany({ where: { machineId: id, key: it.key, source: "MANUALE" } });
      continue;
    }
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    await prisma.machineMilestone.upsert({
      where: { machineId_key: { machineId: id, key: it.key } },
      update: { date: d, source: "MANUALE" },
      create: { machineId: id, key: it.key, date: d, source: "MANUALE" },
    });

    // Mantiene allineato il campo "Inizio produzione" del fascicolo
    if (it.key === "production_start") {
      await prisma.machine.update({ where: { id }, data: { productionStart: d } });
    }
  }

  return NextResponse.json({ ok: true, skipped });
}
