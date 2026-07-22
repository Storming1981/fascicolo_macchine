import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { renderRapportinoPdf } from "@/lib/rapportinoRender";
import { readUploadBytes } from "@/lib/uploads";
import { isGoogleConfigured, resolveSenderEmail, sendGmailAs, type MailAttachment } from "@/lib/google";

const emails = (raw: unknown): string[] =>
  String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));

/**
 * Invia il PDF del rapportino via Gmail (account aziendale collegato).
 * Body: { to, cc?, subject, body }. Traccia l'invio su Rapportino.sentAt/sentTo.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  if (!isGoogleConfigured())
    return NextResponse.json({ error: "Google non configurato. Contatta l'amministratore." }, { status: 503 });
  if (!(await resolveSenderEmail(user.id)))
    return NextResponse.json(
      { error: "Nessuna casella Gmail collegata: collega la tua in Impostazioni o usa quella aziendale." },
      { status: 503 }
    );

  const { id, rid } = await ctx.params;
  const rap = await prisma.rapportino.findFirst({ where: { id: rid, interventoId: id }, select: { id: true } });
  if (!rap) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });

  const b = await req.json().catch(() => null);
  const to = emails(b?.to);
  const cc = emails(b?.cc);
  if (to.length === 0) return NextResponse.json({ error: "Indica almeno un destinatario valido." }, { status: 400 });
  const subject = String(b?.subject || "").trim() || "Rapportino di intervento";
  const text = String(b?.body || "").trim();
  const includeAttachments = b?.includeAttachments !== false; // default: sì

  const out = await renderRapportinoPdf(rid);
  if (!out) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });

  const attachments: MailAttachment[] = [
    { filename: out.filename, mimeType: "application/pdf", content: Buffer.from(out.bytes) },
  ];
  if (includeAttachments) {
    const atts = await prisma.rapportinoAttachment.findMany({
      where: { rapportinoId: rid },
      orderBy: { createdAt: "asc" },
    });
    for (const a of atts) {
      const file = await readUploadBytes(a.path);
      if (file) attachments.push({ filename: a.filename, mimeType: a.mime || file.mime, content: file.bytes });
    }
  }

  try {
    const { from } = await sendGmailAs(user.id, {
      to,
      cc,
      subject,
      text: `${text}\n\n—\nInviato da ${user.name} · Fascicolo Tecnico ZATO`,
      attachments,
    });

    await prisma.rapportino.update({
      where: { id: rid },
      data: { sentAt: new Date(), sentTo: [...to, ...cc].join(", ") },
    });

    return NextResponse.json({ ok: true, from, to, cc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invio fallito" }, { status: 502 });
  }
}
