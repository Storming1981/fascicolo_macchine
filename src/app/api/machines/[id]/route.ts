import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import type { MachineStatus } from "@prisma/client";

const VALID: MachineStatus[] = [
  "PRODUCTION",
  "TESTING",
  "SHIPPED",
  "INSTALLED",
  "MAINTENANCE",
  "SCRAPPED",
];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const { id } = await ctx.params;
  const b = await req.json();
  const data: Record<string, unknown> = {};
  if (b.status && VALID.includes(b.status)) data.status = b.status;
  if (typeof b.progress === "number") data.progress = Math.max(0, Math.min(100, b.progress));
  if (typeof b.notes === "string") data.notes = b.notes;
  if (typeof b.job === "string" && b.job.trim()) data.job = b.job.trim();
  if (typeof b.jobBody === "string") data.jobBody = b.jobBody.trim() || null;
  if (typeof b.jobContainer === "string") data.jobContainer = b.jobContainer.trim() || null;
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  const machine = await prisma.machine.update({ where: { id }, data });

  if (b.status && VALID.includes(b.status)) {
    await prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: b.status as MachineStatus,
        type: "milestone",
        title: `Stato aggiornato: ${b.status}`,
        actorName: user.name,
        authorId: user.id,
      },
    });
  }
  return NextResponse.json({ ok: true, code: machine.code });
}
