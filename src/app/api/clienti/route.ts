import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { resolveCountry } from "@/lib/domain";

async function nextCustomerCode(): Promise<string> {
  const last = await prisma.customer.findFirst({
    where: { code: { startsWith: "C-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let n = 0;
  if (last) {
    const parsed = parseInt(last.code.replace("C-", ""), 10);
    if (!Number.isNaN(parsed)) n = parsed;
  }
  for (let seq = n + 1; ; seq++) {
    const code = `C-${String(seq).padStart(3, "0")}`;
    const exists = await prisma.customer.findUnique({ where: { code } });
    if (!exists) return code;
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const clienti = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sites: true, interventi: true, machines: true } } },
  });
  return NextResponse.json({ clienti });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b.name !== "string" || !b.name.trim())
    return NextResponse.json({ error: "Nome obbligatorio" }, { status: 400 });

  const code = typeof b.code === "string" && b.code.trim() ? b.code.trim() : await nextCustomerCode();
  const country = resolveCountry(b.country);

  const customer = await prisma.customer.create({
    data: {
      code,
      name: b.name.trim(),
      city: typeof b.city === "string" ? b.city.trim() || null : null,
      province: typeof b.province === "string" ? b.province.trim() || null : null,
      country: country.label,
      countryCode: country.code,
      contractType: typeof b.contractType === "string" ? b.contractType.trim() || null : null,
      phone: typeof b.phone === "string" ? b.phone.trim() || null : null,
      email: typeof b.email === "string" ? b.email.trim() || null : null,
      erpConto: Number.isInteger(b.erpConto) ? b.erpConto : null,
    },
  });
  return NextResponse.json({ ok: true, id: customer.id, code });
}
