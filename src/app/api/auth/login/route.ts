import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email e password obbligatori" }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });
    }
    await createSession({ id: user.id, name: user.name, email: user.email, role: user.role });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Errore di accesso" }, { status: 500 });
  }
}
