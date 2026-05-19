import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { MILESTONE_KEYS } from "@/lib/milestones";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = await req.json();
  const items: { key: string; date: string }[] = Array.isArray(b.items) ? b.items : [];

  for (const it of items) {
    if (!MILESTONE_KEYS.includes(it.key as never)) continue;
    const raw = String(it.date || "").trim();
    if (!raw) {
      await prisma.machineMilestone.deleteMany({ where: { machineId: id, key: it.key } });
      continue;
    }
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    await prisma.machineMilestone.upsert({
      where: { machineId_key: { machineId: id, key: it.key } },
      update: { date: d, source: "MANUALE" },
      create: { machineId: id, key: it.key, date: d, source: "MANUALE" },
    });
  }

  // Mantiene allineato il campo "Inizio produzione" del fascicolo
  const ps = items.find((i) => i.key === "production_start");
  if (ps && String(ps.date || "").trim()) {
    await prisma.machine.update({
      where: { id },
      data: { productionStart: new Date(ps.date) },
    });
  }

  return NextResponse.json({ ok: true });
}
