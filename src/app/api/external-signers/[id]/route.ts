import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { parseExternalSigner } from "@/lib/externalSigners";

async function guard() {
  const user = await currentUser();
  if (!user) return { res: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };
  if (!(await userCan(user.role, "users.manage")))
    return { res: NextResponse.json({ error: "Permesso negato" }, { status: 403 }) };
  return { user };
}

/** PATCH — modifica anagrafica (`{firstName,lastName,company,...}`) o `{active}`. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  // L'accesso all'app segue la scheda: disattivare l'esterno lo chiude fuori.
  if (typeof b.active === "boolean" && Object.keys(b).length === 1) {
    await prisma.externalSigner.update({ where: { id }, data: { active: b.active } });
    await prisma.user.updateMany({ where: { externalSignerId: id }, data: { active: b.active } });
    return NextResponse.json({ ok: true });
  }
  const p = parseExternalSigner(b);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  await prisma.externalSigner.update({
    where: { id },
    data: { ...p.data, ...(typeof b.active === "boolean" ? { active: b.active } : {}) },
  });
  // nome e ditta dell'accesso restano quelli della scheda
  await prisma.user.updateMany({
    where: { externalSignerId: id },
    data: { name: `${p.data.firstName} ${p.data.lastName}`, company: p.data.company },
  });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — chi non ha mai firmato si cancella; chi ha firmato si disattiva
 * soltanto, altrimenti il verbale perderebbe il collegamento con il firmatario.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.res) return g.res;
  const { id } = await ctx.params;
  const signs = await prisma.collaudo.count({ where: { approverExternalId: id } });
  const account = await prisma.user.findUnique({ where: { externalSignerId: id }, select: { id: true } });
  if (signs > 0 || account) {
    // con un accesso puo' aver compilato verbali: si disattiva anche quello
    await prisma.externalSigner.update({ where: { id }, data: { active: false } });
    await prisma.user.updateMany({ where: { externalSignerId: id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.externalSigner.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: true });
}
