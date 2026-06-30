import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { resolveCountry } from "@/lib/domain";
import type { Prisma } from "@prisma/client";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const data: Prisma.CustomerUpdateInput = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.city === "string") data.city = b.city.trim() || null;
  if (typeof b.province === "string") data.province = b.province.trim() || null;
  if (typeof b.contractType === "string") data.contractType = b.contractType.trim() || null;
  if (typeof b.phone === "string") data.phone = b.phone.trim() || null;
  if (typeof b.email === "string") data.email = b.email.trim() || null;
  if (typeof b.country === "string" && b.country.trim()) {
    const c = resolveCountry(b.country);
    data.country = c.label;
    data.countryCode = c.code;
  }
  if (b.erpConto === null) data.erpConto = null;
  else if (Number.isInteger(b.erpConto)) data.erpConto = b.erpConto;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  const customer = await prisma.customer.update({ where: { id }, data });
  return NextResponse.json({ ok: true, code: customer.code });
}
