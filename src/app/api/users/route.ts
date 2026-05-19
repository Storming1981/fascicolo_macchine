import { NextResponse } from "next/server";
import { currentUser, hashPassword, hashPin } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

const ROLES: Role[] = [
  "ADMIN",
  "CAPO_OFFICINA",
  "MONTATORE",
  "CABLATORE",
  "PROGRAMMATORE",
  "COLLAUDATORE",
  "TECNICO_CAMPO",
  "LOGISTICA",
];

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "users.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const b = await req.json();
  const name = String(b.name || "").trim();
  const email = String(b.email || "").toLowerCase().trim();
  const password = String(b.password || "");
  const role = (ROLES.includes(b.role) ? b.role : "MONTATORE") as Role;
  const pin = String(b.pin || "").trim();

  if (!name || !email || password.length < 6)
    return NextResponse.json({ error: "Nome, email e password (min 6) obbligatori" }, { status: 400 });
  if (pin && !/^\d{4,6}$/.test(pin))
    return NextResponse.json({ error: "Il PIN deve avere 4-6 cifre" }, { status: 400 });

  const dup = await prisma.user.findUnique({ where: { email } });
  if (dup) return NextResponse.json({ error: "Email già registrata" }, { status: 409 });

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role,
      pinHash: pin ? await hashPin(pin) : null,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "users.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const b = await req.json();
  const id = String(b.id || "");
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (typeof b.active === "boolean") data.active = b.active;
  if (b.pin && /^\d{4,6}$/.test(String(b.pin))) data.pinHash = await hashPin(String(b.pin));
  if (b.password && String(b.password).length >= 6)
    data.passwordHash = await hashPassword(String(b.password));
  if (b.role && ROLES.includes(b.role)) data.role = b.role;
  await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
