import "server-only";
import { prisma } from "./db";
import { sendGmailAs } from "./google";
import { sendPushToUser } from "./push";
import { unreadCount } from "./notifications";
import type { Notice } from "./interventoNotify";

/**
 * Recapito delle notifiche sulle tre sponde: **push** (arriva ad app chiusa),
 * **e-mail**, e la campanella — che non ha bisogno di nulla, perché legge dal
 * database.
 *
 * Gira SEMPRE fuori dalla richiesta HTTP (`after()`): assegnare un intervento
 * non deve fallire perché Gmail è lento, il token è scaduto o nessuno ha ancora
 * collegato una casella. L'esito della mail finisce sulla riga della notifica
 * (`emailSentAt` / `emailError`), altrimenti un'e-mail mai partita resterebbe
 * invisibile a tutti.
 *
 * Il mittente è la casella dell'utente che ha fatto l'assegnazione (Gmail
 * personale se collegata, altrimenti quella aziendale): il capo cantiere riceve
 * il cantiere da chi glielo ha dato, e può rispondere direttamente.
 *
 * **Il push va per primo**: è quello che fa vibrare il telefono, e non deve
 * aspettare che Gmail abbia finito di spedire agli altri della squadra.
 */

/**
 * Domini fittizi presenti in anagrafica: gli operatori importati dal timbratore
 * hanno `NNN@timbratore.local` e gli accessi al portale `c-NNN@portale.zato`.
 * Non sono caselle vere: spedirci significa solo riempire di bounce la posta di
 * chi assegna. La notifica nell'app arriva lo stesso — è quella che conta — e
 * il motivo del mancato invio resta scritto sulla riga, così si vede da dove
 * arriva quando qualcuno chiede perché non ha ricevuto la mail.
 */
const UNDELIVERABLE = /(\.local|\.invalid|localhost|portale\.zato)$/i;

function undeliverableReason(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain || !email.includes("@")) return "indirizzo non valido";
  if (UNDELIVERABLE.test(domain)) return `dominio non recapitabile (${domain})`;
  return null;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const NAVY = "#15324f";
const ACCENT = "#2f6aed";

/** Mail HTML: intestazione, riga di apertura, tabella dei dati, bottone. */
function renderHtml(notice: Notice, link: string | null): string {
  const b = notice.mail.brief;
  const rows = b.facts
    .map(
      (f) => `<tr>
        <td style="padding:7px 14px 7px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${esc(f.label)}</td>
        <td style="padding:7px 0;color:#0f172a;font-size:13px;font-weight:600">${esc(f.value)}</td>
      </tr>`
    )
    .join("");

  const desc = b.description
    ? `<div style="margin-top:18px;padding:14px 16px;background:#f4f6f9;border-radius:8px">
         <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Descrizione</div>
         <div style="color:#0f172a;font-size:13px;line-height:1.6;white-space:pre-wrap">${esc(b.description)}</div>
       </div>`
    : "";

  const button = link
    ? `<div style="margin-top:24px">
         <a href="${esc(link)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">Apri l'intervento</a>
       </div>`
    : "";

  return `<!doctype html><html lang="it"><body style="margin:0;padding:24px;background:#f4f6f9;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
    <div style="background:${NAVY};padding:18px 24px">
      <div style="color:#fff;font-size:16px;font-weight:650">ZATO · Fascicolo Tecnico</div>
      <div style="color:#9fb6cc;font-size:12px;margin-top:2px">Notifica di cantiere</div>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 10px;font-size:19px;color:${NAVY};font-weight:650">${esc(notice.mail.subject)}</h1>
      <p style="margin:0 0 20px;color:#334155;font-size:14px;line-height:1.6">${esc(notice.mail.intro)}</p>
      <div style="font-size:15px;font-weight:650;color:${NAVY};padding-bottom:10px;border-bottom:1px solid #e2e8f0">${esc(b.code)} — ${esc(b.title)}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">${rows}</table>
      ${desc}
      ${button}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">
      Messaggio automatico del Fascicolo Tecnico ZATO. La stessa notifica è nell'app, sotto la campanella.
    </div>
  </div>
</body></html>`;
}

/**
 * Notifica push ai dispositivi del destinatario: è l'unica sponda che arriva
 * ad app chiusa. Il corpo è la sola frase di apertura — sulla schermata
 * bloccata il brief intero non ci starebbe e verrebbe troncato a metà parola;
 * il resto si legge aprendo, che è proprio quello che deve fare.
 */
async function pushNotice(n: Notice, notificationId: string): Promise<void> {
  const userId = n.notification.userId;
  const intro = n.notification.body.split("\n\n")[0];
  try {
    await sendPushToUser(userId, {
      title: n.notification.title,
      body: `${intro}\n${n.mail.brief.summary}`.trim(),
      // In Campo la pagina dell'intervento è un'altra: il service worker apre
      // un URL solo, quindi si manda quello che funziona per tutti i ruoli.
      url: `/notifiche`,
      tag: `intervento-${n.mail.brief.id}`,
      priority: n.notification.tone === "alert" ? 1 : 3,
      notificationId,
      unread: await unreadCount(userId),
    });
  } catch {
    // Un push perso non deve fermare la mail che segue.
  }
}

/**
 * Recapita le notifiche appena create: prima il push a tutti, poi le mail.
 * `ids` e `notices` sono allineati per indice (stesso ordine di salvataggio).
 */
export async function deliverNotifications(
  ids: string[],
  notices: Notice[],
  actorId: string,
  baseUrl: string | null
): Promise<void> {
  // Push per primo e tutti insieme: è la sponda che fa vibrare il telefono.
  await Promise.all(notices.map((n, i) => (ids[i] ? pushNotice(n, ids[i]) : Promise.resolve())));

  for (let i = 0; i < notices.length; i++) {
    const id = ids[i];
    const n = notices[i];
    const to = n.notification.emailTo;
    if (!id || !to) continue;

    const bad = undeliverableReason(to);
    if (bad) {
      await prisma.notification
        .update({
          where: { id },
          data: { emailError: `Mail non inviata: ${bad}. Aggiorna l'indirizzo in Persone.` },
        })
        .catch(() => null);
      continue;
    }

    const link = baseUrl ? `${baseUrl}/service/interventi/${n.mail.brief.id}` : null;
    const text = [n.notification.body, link ? `\n\nApri l'intervento: ${link}` : ""].join("");

    try {
      const res = await sendGmailAs(actorId, {
        to: [to],
        subject: `[ZATO] ${n.mail.subject}`,
        text,
        html: renderHtml(n, link),
      });
      await prisma.notification.update({
        where: { id },
        data: { emailSentAt: new Date(), emailFrom: res.from, emailError: null },
      });
    } catch (e) {
      await prisma.notification
        .update({
          where: { id },
          data: { emailError: e instanceof Error ? e.message : String(e) },
        })
        .catch(() => null);
    }
  }
}
