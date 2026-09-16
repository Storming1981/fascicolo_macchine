import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { isSheetKind, sheetDef, type SheetKind } from "@/lib/allestimento";
import { renderSheetPdf } from "@/lib/allestimentoRender";
import { isGoogleConfigured, resolveSenderEmail, sendGmailAs, type MailAttachment } from "@/lib/google";

const emails = (raw: unknown): string[] =>
  String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));

/**
 * Invia per e-mail i PDF delle schede di allestimento, generati al momento dai
 * dati del fascicolo: niente download e ricaricamento a mano. Parte dalla casella
 * Gmail dell'utente (collegata dal profilo) o, in mancanza, da quella aziendale.
 * Body: { to, cc?, subject, body?, kinds: ["TRITURATORE" | "CONTAINER"] }.
 * L'invio va a diario con destinatari, schede e mittente.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")) && !(await userCan(user.role, "machine.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  if (!isGoogleConfigured())
    return NextResponse.json({ error: "Invio e-mail non configurato. Contatta l'amministratore." }, { status: 503 });
  if (!(await resolveSenderEmail(user.id)))
    return NextResponse.json(
      { error: "Nessuna casella Gmail collegata: collegala dal tuo profilo (clic sull'avatar in alto)." },
      { status: 409 }
    );

  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const to = emails(b?.to);
  const cc = emails(b?.cc);
  if (!to.length) return NextResponse.json({ error: "Indica almeno un destinatario valido." }, { status: 400 });
  const kinds: SheetKind[] = Array.isArray(b?.kinds) ? [...new Set(b.kinds.filter(isSheetKind))] as SheetKind[] : [];
  if (!kinds.length) return NextResponse.json({ error: "Scegli almeno una scheda da allegare." }, { status: 400 });

  const attachments: MailAttachment[] = [];
  let machineCode = "";
  for (const kind of kinds) {
    const out = await renderSheetPdf(id, kind);
    if (!out) return NextResponse.json({ error: "Schede non disponibili per questa macchina" }, { status: 404 });
    machineCode = out.machineCode;
    attachments.push({ filename: out.filename, mimeType: "application/pdf", content: Buffer.from(out.bytes) });
  }

  const subject = String(b?.subject ?? "").trim().slice(0, 200) || `Schede di allestimento ${machineCode}`;
  const text = String(b?.body ?? "").trim().slice(0, 10_000);

  let from: string;
  try {
    ({ from } = await sendGmailAs(user.id, {
      to,
      cc,
      subject,
      text: `${text}\n\n—\nInviato da ${user.name} · Fascicolo Tecnico ZATO`,
      attachments,
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invio fallito" }, { status: 502 });
  }

  const labels = kinds.map((k) => `${sheetDef(k).code} ${k === "CONTAINER" ? "Container" : "Trituratore"}`);
  await prisma.diaryEvent.create({
    data: {
      machineId: id,
      phase: "PRODUCTION",
      type: "note",
      title: `Schede di allestimento inviate via e-mail (${labels.join(", ")})`,
      note: `Da ${from} a ${to.join(", ")}${cc.length ? ` · Cc ${cc.join(", ")}` : ""} · Oggetto: ${subject}`,
      actorName: user.name,
      authorId: user.id,
    },
  });

  return NextResponse.json({ ok: true, from, to, cc });
}
