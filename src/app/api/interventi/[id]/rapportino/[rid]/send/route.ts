import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { renderRapportinoPdf } from "@/lib/rapportinoRender";
import { readUploadBytes } from "@/lib/uploads";
import { isGoogleConfigured, resolveSenderEmail, sendGmailAs, type MailAttachment } from "@/lib/google";
import { isFeedConfigured, fetchOpenSessionsForCommessa } from "@/lib/presenceFeed";

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

const emails = (raw: unknown): string[] =>
  String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));

/**
 * Invia il PDF del rapportino via Gmail (account aziendale collegato).
 * Body: { to, cc?, subject, body }. Traccia l'invio su Rapportino.sentAt/sentTo.
 *
 * Il rapportino si compila e si firma mentre si è ancora in cantiere (timbrati):
 * l'INVIO invece aspetta che tutte le timbrature della giornata siano chiuse,
 * altrimenti si manderebbe al cliente un PDF con ore parziali.
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
  const rap = await prisma.rapportino.findFirst({
    where: { id: rid, interventoId: id },
    select: { id: true, date: true, intervento: { select: { commessa: true } } },
  });
  if (!rap) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });

  // --- Timbrature ancora aperte nella giornata → ore incomplete, invio negato ---
  if (rap.intervento.commessa && isFeedConfigured()) {
    try {
      const openSessions = await fetchOpenSessionsForCommessa(rap.intervento.commessa);
      const dayKey = isoDay(rap.date);
      const stillIn = openSessions.filter((o) => isoDay(o.startedAt ?? new Date()) === dayKey);
      if (stillIn.length > 0) {
        const techs = stillIn.map((o) => o.tech).filter((t): t is string => !!t);
        return NextResponse.json(
          {
            error:
              `Timbrature ancora aperte per questa giornata${techs.length ? ` (${techs.join(", ")})` : ""}: ` +
              "registra l'uscita dal timbratore, premi \"Sincronizza ore\" e poi invia il rapportino.",
            openTechs: techs,
          },
          { status: 409 }
        );
      }
    } catch {
      // timbratore non raggiungibile → non blocchiamo l'invio
    }
  }

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
