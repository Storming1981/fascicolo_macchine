import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { currentUser, hashPassword } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";

/**
 * Accesso al PORTALE per un cliente.
 * GET  → stato dell'accesso (esiste un utente CLIENTE per questo cliente?).
 * POST → crea o resetta l'accesso: genera una password, la restituisce UNA volta.
 *        body opzionale { email }: se assente usa <code>@portale.zato.
 * Permesso: customer.manage.
 */

function genPassword(): string {
  // password leggibile: 3 gruppi da 4 (no caratteri ambigui)
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alpha[b[i] % alpha.length];
  }
  return out;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const account = await prisma.user.findFirst({
    where: { role: "CLIENTE", customerId: id },
    select: { id: true, email: true, active: true, createdAt: true },
  });
  return NextResponse.json({ account });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
  if (!customer) return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const emailIn = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = genPassword();
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findFirst({ where: { role: "CLIENTE", customerId: id } });
  let email = existing?.email ?? emailIn ?? "";
  if (!email) email = `${customer.code.toLowerCase()}@portale.zato`;

  // email deve restare unica: se richiesta e già usata da un altro utente → errore
  if (emailIn && emailIn !== existing?.email) {
    const clash = await prisma.user.findUnique({ where: { email: emailIn } });
    if (clash && clash.id !== existing?.id)
      return NextResponse.json({ error: "Email già in uso da un altro utente" }, { status: 409 });
    email = emailIn;
  }

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, email, active: true, name: `Portale ${customer.name}` },
    });
  } else {
    await prisma.user.create({
      data: {
        name: `Portale ${customer.name}`,
        email,
        passwordHash,
        role: "CLIENTE",
        customerId: id,
        active: true,
      },
    });
  }

  // La password in chiaro si mostra SOLO ora (non è recuperabile dopo).
  return NextResponse.json({ ok: true, email, password });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "customer.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  await prisma.user.deleteMany({ where: { role: "CLIENTE", customerId: id } });
  return NextResponse.json({ ok: true });
}
