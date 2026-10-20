import { NextResponse } from "next/server";
import { currentUser, hashPassword } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { normalizeUsername, usernameEmail } from "@/lib/externalSigners";

/**
 * POST /api/external-signers/[id]/account — crea l'accesso all'app per una
 * persona esterna: utente con ruolo COLLAUDATORE_ESTERNO, nome e ditta presi
 * dalla scheda. Body: { username, password } — niente e-mail: agli esterni
 * non servirebbe a nulla.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "users.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const { id } = await ctx.params;
  const ext = await prisma.externalSigner.findUnique({ where: { id }, include: { account: true } });
  if (!ext) return NextResponse.json({ error: "Persona esterna non trovata" }, { status: 404 });
  if (ext.account) return NextResponse.json({ error: "Ha già un accesso" }, { status: 409 });

  const b = await req.json().catch(() => ({}));
  const username = normalizeUsername(b.username);
  const password = String(b.password || "");
  if (!username)
    return NextResponse.json(
      { error: "Nome utente: 3-40 caratteri fra lettere minuscole, cifre, punto e trattino" },
      { status: 400 }
    );
  if (password.length < 6)
    return NextResponse.json({ error: "Password di almeno 6 caratteri" }, { status: 400 });
  const email = usernameEmail(username);
  if (await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } }))
    return NextResponse.json({ error: "Nome utente già in uso" }, { status: 409 });

  await prisma.user.create({
    data: {
      name: `${ext.firstName} ${ext.lastName}`.trim(),
      email,
      username,
      passwordHash: await hashPassword(password),
      role: "COLLAUDATORE_ESTERNO",
      company: ext.company,
      phone: ext.phone,
      active: ext.active,
      externalSignerId: ext.id,
    },
  });
  return NextResponse.json({ ok: true });
}
