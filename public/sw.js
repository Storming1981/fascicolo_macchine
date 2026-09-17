/*
 * Service worker del Fascicolo Tecnico ZATO.
 *
 * Esiste per UNA cosa sola: ricevere le notifiche push quando l'app e' chiusa.
 * Il service worker gira anche ad app chiusa, quindi e' l'unico posto da cui
 * puo' comparire una notifica di sistema sul telefono del capo cantiere.
 *
 * NON fa cache offline: l'app e' tutta server-rendered e una cache sbagliata
 * servirebbe fascicoli vecchi, che su un cantiere e' peggio di un errore di
 * rete. Qui dentro si tocca solo il push.
 */

// Si attiva subito, senza aspettare che si chiudano le schede aperte:
// altrimenti dopo un deploy le notifiche resterebbero al worker vecchio.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "ZATO", body: event.data ? event.data.text() : "" };
  }

  const title = d.title || "ZATO · Fascicolo Tecnico";
  const options = {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Una notifica per intervento: se il cantiere viene riprogrammato due
    // volte non si accumulano tre avvisi che dicono cose diverse.
    tag: d.tag || "zato-notifica",
    renotify: true,
    requireInteraction: d.priority === 1,
    data: { url: d.url || "/", notificationId: d.notificationId || null },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Aggiorna il numerino sull'icona dell'app, se il sistema lo supporta.
      try {
        if (typeof d.unread === "number" && self.navigator.setAppBadge) {
          if (d.unread > 0) await self.navigator.setAppBadge(d.unread);
          else await self.navigator.clearAppBadge();
        }
      } catch {
        /* badge non supportato: la notifica e' comunque comparsa */
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Se l'app e' gia' aperta si riusa quella finestra invece di aprirne
      // un'altra: sul telefono due schede della stessa app confondono.
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(url).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
