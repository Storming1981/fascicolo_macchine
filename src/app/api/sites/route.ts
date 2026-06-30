import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b.customerId !== "string" || typeof b.name !== "string" || !b.name.trim())
    return NextResponse.json({ error: "Cliente e nome cantiere obbligatori" }, { status: 400 });

  const site = await prisma.site.create({
    data: {
      customerId: b.customerId,
      name: b.name.trim(),
      city: typeof b.city === "string" ? b.city.trim() || null : null,
      province: typeof b.province === "string" ? b.province.trim() || null : null,
      address: typeof b.address === "string" ? b.address.trim() || null : null,
      lat: num(b.lat),
      lng: num(b.lng),
      status: typeof b.status === "string" ? b.status : "ok",
    },
  });
  return NextResponse.json({ ok: true, id: site.id });
}
