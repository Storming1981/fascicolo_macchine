import webpush from "web-push";
import { prisma } from "./db";

/**
 * Web Push: la notifica che arriva ANCHE ad app chiusa.
 *
 * La campanella in pagina si aggiorna col polling, ma solo mentre l'app e'
 * aperta. Il capo cantiere che riceve il cantiere la sera, col telefono in
 * tasca, lo scopre solo da qui (o dalla mail).
 *
 * L'iscrizione e' per DISPOSITIVO, non per utente: telefono e tablet dello
 * stesso tecnico sono due righe. Si spedisce a tutte.
 *
 * Config in .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 * Senza chiavi la funzione non lancia: l'app resta identica e restano la
 * campanella e la mail.
 */

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:service@zato.it", pub, priv);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

/** Chiave pubblica da passare al browser per iscriversi. */
export function publicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  priority?: number;
  notificationId?: string;
  unread?: number;
};

/**
 * Spedisce a tutti i dispositivi di un utente. Non lancia mai: un push perso
 * non deve rompere l'assegnazione di un intervento.
 * Ritorna quante consegne sono riuscite.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return 0;

  const body = JSON.stringify(payload);
  let ok = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24 } // un giorno: oltre, il cantiere e' notizia vecchia
        );
        ok++;
        await prisma.pushSubscription.update({
          where: { id: s.id },
          data: { lastOkAt: new Date(), failCount: 0 },
        });
      } catch (e) {
        // 404/410 = iscrizione morta (app disinstallata, permesso revocato,
        // browser che ha ruotato l'endpoint). Va cancellata, altrimenti resta
        // li' a fallire per sempre a ogni notifica.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => null);
        } else {
          await prisma.pushSubscription
            .update({ where: { id: s.id }, data: { failCount: { increment: 1 } } })
            .catch(() => null);
        }
      }
    })
  );

  return ok;
}
