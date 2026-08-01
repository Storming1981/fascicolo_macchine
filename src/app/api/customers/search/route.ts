import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Ricerca clienti per la tendina ricercabile degli interventi.
 * Query: ?q=  (nome/città/codice). Senza q → primi 30 in ordine alfabetico.
 * Restituisce anche i cantieri, per popolare la tendina "Cantiere".
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const where =
    q.length >= 1
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { city: { contains: q, mode: "insensitive" as const } },
            { code: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

  const rows = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    take: 30,
    select: {
      id: true,
      name: true,
      city: true,
      sites: { orderBy: { name: "asc" }, select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ customers: rows });
}
