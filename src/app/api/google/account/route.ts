import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import {
  isGoogleConfigured,
  getUserGoogleInfo,
  getCompanyGoogleInfo,
  getPhotoArchiveInfo,
  disconnectUser,
  disconnectCompany,
  disconnectArchive,
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
    // L'archivio foto lo vedono tutti (serve a sapere se il pulsante c'è);
    // collegarlo e scollegarlo resta a chi amministra.
    photoArchive: await getPhotoArchiveInfo(),
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

/**
 * Scollega un account. `?target=me` (default), `?target=company` o
 * `?target=archive` (gli ultimi due: `settings.manage`).
 */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const t = new URL(req.url).searchParams.get("target");
  const target = t === "company" ? "company" : t === "archive" ? "archive" : "me";
  if (target !== "me") {
    if (!(await userCan(user.role, "settings.manage")))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
    if (target === "company") await disconnectCompany();
    else await disconnectArchive();
  } else {
    await disconnectUser(user.id);
  }
  return NextResponse.json({ ok: true });
}
