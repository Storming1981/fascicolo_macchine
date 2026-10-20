import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { parseExternalSigner } from "@/lib/externalSigners";

/**
 * GET /api/external-signers[?all=1] — anagrafica delle persone esterne che
 * possono firmare. Di default solo le attive (servono per scegliere chi firma);
 * `all=1` anche le disattivate (gestione in Persone).
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const all = new URL(req.url).searchParams.get("all") === "1";
  const rows = await prisma.externalSigner.findMany({
    where: all ? {} : { active: true },
    orderBy: [{ company: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    include: { _count: { select: { collaudi: true } } },
  });
  return NextResponse.json({
    signers: rows.map(({ _count, createdAt: _c, updatedAt: _u, createdById: _i, createdByName: _n, ...r }) => ({
      ...r,
      signs: _count.collaudi,
    })),
  });
}

/**
 * POST /api/external-signers — nuova persona esterna. La crea chi gestisce gli
 * operatori, ma anche chi raccoglie firme (`machine.sign`): il collaudatore
 * davanti all'ispettore del cliente non deve aspettare un amministratore.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "users.manage")) && !(await userCan(user.role, "machine.sign")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const p = parseExternalSigner(b ?? {});
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const dup = await prisma.externalSigner.findFirst({
    where: {
      firstName: { equals: p.data.firstName, mode: "insensitive" },
      lastName: { equals: p.data.lastName, mode: "insensitive" },
      company: { equals: p.data.company, mode: "insensitive" },
    },
  });
  if (dup) return NextResponse.json({ error: "Persona già presente per questa ditta" }, { status: 409 });
  const s = await prisma.externalSigner.create({
    data: { ...p.data, createdById: user.id, createdByName: user.name },
  });
  return NextResponse.json({ signer: { ...p.data, id: s.id, active: true, signs: 0 } });
}
