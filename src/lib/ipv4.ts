import dns from "dns";

/**
 * **Google Foto rifiuta la VPS quando esce in IPv6.**
 *
 * Misurato dal server, la stessa richiesta senza token:
 *
 * ```
 * curl -4 https://photoslibrary.googleapis.com/v1/albums  → 401 JSON (normale)
 * curl -6 https://photoslibrary.googleapis.com/v1/albums  → 403 HTML (bloccata)
 * ```
 *
 * Node, dalla 18, preferisce l'IPv6 quando c'è: quindi l'app usciva sempre
 * dalla parte sbagliata e ogni chiamata tornava con la **pagina HTML di errore
 * 403 del front-end di Google** — non un errore JSON dell'API. È il motivo per
 * cui sembrava un'API spenta o un permesso mancante: un 403 che non è JSON non
 * arriva dal servizio, arriva da prima. L'indirizzo IPv6 della VPS sta in un
 * intervallo da datacenter che Google non accetta su Photos; Gmail e Calendar
 * invece passano, ed è per questo che il guasto sembrava circoscritto.
 *
 * `/v1/uploads` rispondeva 200 anche in IPv6, il che rendeva il tutto ancora
 * più confuso: i byte salivano e falliva il passo dopo.
 *
 * La preferenza è **di processo** e si imposta una volta: la chiamano i moduli
 * che parlano con Google Foto, così vale sia per le route sia per gli script da
 * riga di comando (`gphoto:retry`), che non passano da `instrumentation.ts`.
 * Non disattiva l'IPv6: lo mette dopo l'IPv4, quindi tutto il resto continua a
 * funzionare come prima.
 */
let fatto = false;

export function preferIpv4(): void {
  if (fatto) return;
  fatto = true;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    // ambienti senza il modulo dns (edge): lì non gira niente di tutto questo
  }
}
