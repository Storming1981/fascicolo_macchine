import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Ricerca rapida della topbar.
 * Se il termine corrisponde a una matricola/serial di un componente (o al
 * codice fascicolo / job), apre direttamente quella macchina; altrimenti
 * ricade nella lista filtrata.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ type: "list", q: "" });

  // 1) match esatto: codice fascicolo, job, oppure matricola componente
  const exact = await prisma.machine.findFirst({
    where: {
      OR: [
        { code: { equals: q, mode: "insensitive" } },
        { job: { equals: q } },
        { jobBody: { equals: q } },
        { jobContainer: { equals: q } },
        {
          components: {
            some: { items: { some: { serial: { equals: q, mode: "insensitive" } } } },
          },
        },
      ],
    },
    select: { code: true },
  });
  if (exact) return NextResponse.json({ type: "machine", code: exact.code });

  // 1b) intervento per codice (INT-xxxx)
  const intervento = await prisma.intervento.findFirst({
    where: { code: { equals: q, mode: "insensitive" } },
    select: { id: true },
  });
  if (intervento) return NextResponse.json({ type: "intervento", id: intervento.id });

  // 1c) cliente per codice (C-xxx) o ragione sociale esatta
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { code: { equals: q, mode: "insensitive" } },
        { name: { equals: q, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (customer) return NextResponse.json({ type: "customer", id: customer.id });

  // 2) match parziale su matricola componente
  const partialSerial = await prisma.machine.findMany({
    where: {
      components: {
        some: { items: { some: { serial: { contains: q, mode: "insensitive" } } } },
      },
    },
    select: { code: true },
    take: 2,
  });
  if (partialSerial.length === 1) {
    return NextResponse.json({ type: "machine", code: partialSerial[0].code });
  }

  // 3) altrimenti lista filtrata (per cliente/modello/paese/ecc.)
  return NextResponse.json({ type: "list", q });
}
