import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import {
  isGoogleConfigured,
  getUserGoogleInfo,
  getCompanyGoogleInfo,
  disconnectUser,
  disconnectCompany,
  sendGmailAs,
} from "@/lib/google";

/** Stato caselle Gmail (personale + aziendale), senza token. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const canCompany = await userCan(user.role, "settings.manage");
  return NextResponse.json({
    configured: isGoogleConfigured(),
    me: await getUserGoogleInfo(user.id),
    company: canCompany ? await getCompanyGoogleInfo() : null,
    canManageCompany: canCompany,
  });
}

/** Mail di prova. Body: { to }. Usa il mittente risolto per l'utente. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const b = await req.json().catch(() => null);
  const to = String(b?.to || user.email || "").trim();
  if (!to.includes("@")) return NextResponse.json({ error: "Indirizzo destinatario non valido" }, { status: 400 });

  try {
    const { from } = await sendGmailAs(user.id, {
      to: [to],
      subject: "Prova invio — Fascicolo Tecnico ZATO",
      text:
        `Questa è una mail di prova inviata dalla piattaforma Fascicolo Tecnico ZATO.\n\n` +
        `Se la stai leggendo, la casella Gmail è collegata correttamente.\n\n` +
        `Prova richiesta da: ${user.name}`,
    });
    return NextResponse.json({ ok: true, from, to });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invio fallito" }, { status: 502 });
  }
}

/** Scollega una casella. `?target=me` (default) o `?target=company` (settings.manage). */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const target = new URL(req.url).searchParams.get("target") === "company" ? "company" : "me";
  if (target === "company") {
    if (!(await userCan(user.role, "settings.manage")))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
    await disconnectCompany();
  } else {
    await disconnectUser(user.id);
  }
  return NextResponse.json({ ok: true });
}
