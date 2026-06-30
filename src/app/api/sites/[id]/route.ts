import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  const data: Prisma.SiteUpdateInput = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.city === "string") data.city = b.city.trim() || null;
  if (typeof b.province === "string") data.province = b.province.trim() || null;
  if (typeof b.address === "string") data.address = b.address.trim() || null;
  if ("lat" in b) data.lat = num(b.lat);
  if ("lng" in b) data.lng = num(b.lng);
  if (typeof b.status === "string") data.status = b.status;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  await prisma.site.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  await prisma.site.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
