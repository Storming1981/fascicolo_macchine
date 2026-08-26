import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Ricerca clienti per le tendine ricercabili (interventi di service e
 * anagrafica del fascicolo macchina).
 * Query: ?q=  (nome/città/codice). Senza q → primi 30 in ordine alfabetico.
 * Restituisce anche i cantieri, per popolare la tendina "Cantiere"/"Sito".
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  // Serve anche a chi crea/modifica fascicoli macchina (senza accesso al Service).
  const allowed = (
    await Promise.all(
      (["service.view", "machine.create", "machine.edit", "customer.manage"] as const).map((a) =>
        userCan(user.role, a)
      )
    )
  ).some(Boolean);
  if (!allowed) return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

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
      code: true,
      name: true,
      city: true,
      country: true,
      countryCode: true,
      sites: { orderBy: { name: "asc" }, select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ customers: rows });
}
