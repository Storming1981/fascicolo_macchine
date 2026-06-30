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

  const badgeId = String(b.badgeId || "").trim() || null;
  const zona = String(b.zona || "").trim() || null;
  if (badgeId) {
    const badgeDup = await prisma.user.findUnique({ where: { badgeId } });
    if (badgeDup) return NextResponse.json({ error: "Matricola/badge già assegnata" }, { status: 409 });
  }

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role,
      pinHash: pin ? await hashPin(pin) : null,
      badgeId,
      zona,
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
  if (typeof b.active === "boolean") {
    if (b.active === false) {
      // niente lockout: non disattivare se stessi né l'ultimo ADMIN attivo
      if (id === user.id)
        return NextResponse.json({ error: "Non puoi disattivare il tuo account" }, { status: 400 });
      const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
      if (target?.role === "ADMIN") {
        const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
        if (activeAdmins <= 1)
          return NextResponse.json({ error: "Deve restare almeno un amministratore attivo" }, { status: 400 });
      }
    }
    data.active = b.active;
  }
  if (b.pin && /^\d{4,6}$/.test(String(b.pin))) data.pinHash = await hashPin(String(b.pin));
  if (b.password && String(b.password).length >= 6)
    data.passwordHash = await hashPassword(String(b.password));
  if (b.role && ROLES.includes(b.role)) data.role = b.role;
  if (typeof b.zona === "string") data.zona = b.zona.trim() || null;
  if (typeof b.badgeId === "string") {
    const badge = b.badgeId.trim() || null;
    if (badge) {
      const badgeDup = await prisma.user.findFirst({ where: { badgeId: badge, NOT: { id } } });
      if (badgeDup) return NextResponse.json({ error: "Badge già assegnato" }, { status: 409 });
    }
    data.badgeId = badge;
  }
  if (typeof b.matricola === "string") {
    const matr = b.matricola.trim() || null;
    if (matr) {
      const dup = await prisma.user.findFirst({ where: { matricola: matr, NOT: { id } } });
      if (dup) return NextResponse.json({ error: "Matricola già assegnata" }, { status: 409 });
    }
    data.matricola = matr;
  }
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.email === "string" && b.email.trim()) {
    const email = b.email.toLowerCase().trim();
    const dup = await prisma.user.findFirst({ where: { email, NOT: { id } } });
    if (dup) return NextResponse.json({ error: "Email già registrata" }, { status: 409 });
    data.email = email;
  }
  if (typeof b.phone === "string") data.phone = b.phone.trim() || null;
  if (typeof b.reparto === "string") data.reparto = b.reparto.trim() || null;
  if (typeof b.photo === "string") data.photo = b.photo.startsWith("data:image") ? b.photo : b.photo === "" ? null : undefined;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nessun campo valido" }, { status: 400 });

  await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
