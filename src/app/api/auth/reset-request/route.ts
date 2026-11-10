import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { createNotifications } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push";
import { sendGmailAs } from "@/lib/google";
import { absoluteUrl } from "@/lib/absoluteUrl";

/**
 * "Ho dimenticato la password": chi non riesce a entrare chiede il ripristino
 * agli amministratori. Non c'è un reset self-service via e-mail perché metà
 * degli utenti non ha una casella vera (timbratore, esterni, portale): la
 * password nuova la imposta l'admin da Persone → Modifica.
 *
 * Rotta pubblica (sta sotto /api/auth/, aperta dal proxy), quindi:
 *   - **risposta sempre uguale**, che l'account esista o no: dalla pagina di
 *     login non si deve poter scoprire quali e-mail sono registrate;
 *   - **una richiesta all'ora per persona**: altrimenti chiunque potrebbe
 *     riempire di avvisi la campanella degli amministratori.
 */
const OK = { ok: true };
const KIND = "PASSWORD_RESET" as const;

export async function POST(req: Request) {
  let id = "";
  let note = "";
  try {
    const b = await req.json();
    id = String(b?.id || "").toLowerCase().trim().slice(0, 200);
    note = String(b?.note || "").trim().slice(0, 500);
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "Scrivi la tua e-mail o il nome utente" }, { status: 400 });

  try {
    const user = id.includes("@")
      ? await prisma.user.findUnique({ where: { email: id } })
      : await prisma.user.findUnique({ where: { username: id } });
    if (!user || !user.active) return NextResponse.json(OK);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.notification.findFirst({
      where: { kind: KIND, actorId: user.id, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) return NextResponse.json(OK);

    const admins = await prisma.user.findMany({
      where: { active: true, role: "ADMIN", id: { not: user.id } },
      select: { id: true, email: true },
    });
    if (!admins.length) return NextResponse.json(OK);

    const who = user.username ? `${user.name} (${user.username})` : `${user.name} (${user.email})`;
    const title = `Ripristino password: ${user.name}`;
    const body =
      `${who} non riesce ad accedere e chiede una nuova password.\n` +
      `Impostala da Persone → Modifica → Nuova password.` +
      (note ? `\n\nMessaggio: ${note}` : "");

    const ids = await createNotifications(
      admins.map((a) => ({
        userId: a.id,
        kind: KIND,
        title,
        body,
        tone: "warn" as const,
        icon: "people",
        href: "/persone",
        actorId: user.id,
        actorName: user.name,
        emailTo: a.email,
      })),
    );

    const link = absoluteUrl(req, "/persone");
    after(async () => {
      for (let i = 0; i < admins.length; i++) {
        const a = admins[i];
        await sendPushToUser(a.id, { title, body, url: "/persone", notificationId: ids[i] });
        if (!a.email || /(\.local|\.invalid|portale\.zato)$/i.test(a.email)) continue;
        try {
          const res = await sendGmailAs("", {
            to: [a.email],
            subject: `[ZATO] ${title}`,
            text: `${body}\n\n${link}`,
          });
          await prisma.notification.update({
            where: { id: ids[i] },
            data: { emailSentAt: new Date(), emailFrom: res.from, emailError: null },
          });
        } catch (e) {
          await prisma.notification
            .update({ where: { id: ids[i] }, data: { emailError: e instanceof Error ? e.message : String(e) } })
            .catch(() => {});
        }
      }
    });
  } catch (e) {
    console.error("[reset-request]", e);
  }
  return NextResponse.json(OK);
}
