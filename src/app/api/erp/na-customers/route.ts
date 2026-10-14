import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Clienti di ZATO North America per la tendina del fascicolo (solo fascicoli
 * destinati agli USA). Legge la **copia locale** `ErpNaCustomer`, che il
 * sync-agent tiene allineata: sulla VPS il gestionale non è raggiungibile.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const customers = await prisma.erpNaCustomer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { name: "asc" },
    take: 50,
    select: { code: true, name: true, city: true, state: true, country: true },
  });
  return NextResponse.json({ customers, total: await prisma.erpNaCustomer.count() });
}
