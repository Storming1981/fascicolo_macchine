/**
 * Lato browser dell'iscrizione Web Push.
 *
 * Il permesso si può chiedere SOLO da un gesto dell'utente: un `requestPermission()`
 * al caricamento viene rifiutato in blocco dai browser (e su Safari brucia
 * l'unica occasione, perché un "no" non si ripropone). Da qui il bottone
 * esplicito nel pannello della campanella.
 */

/** La chiave VAPID viaggia in base64url e va passata come byte al browser. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState =
  | "unsupported" // browser senza service worker o senza Push API
  | "ios-needs-install" // iPhone/iPad: funziona solo con l'app aggiunta alla Home
  | "unconfigured" // il server non ha le chiavi VAPID
  | "denied" // l'utente ha negato il permesso
  | "off" // si può attivare
  | "on"; // questo dispositivo è iscritto

/**
 * iOS accetta le notifiche web solo se la pagina gira come app installata
 * (Aggiungi alla schermata Home). Da Safari normale l'API esiste ma
 * l'iscrizione fallisce sempre: meglio dirlo che lasciare un bottone che non
 * funziona mai.
 */
function iosNeedsInstall(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/** Stato corrente, senza chiedere nulla all'utente. */
export async function getPushState(): Promise<{ state: PushState; endpoint: string | null }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return { state: iosNeedsInstall() ? "ios-needs-install" : "unsupported", endpoint: null };
  if (iosNeedsInstall()) return { state: "ios-needs-install", endpoint: null };
  if (Notification.permission === "denied") return { state: "denied", endpoint: null };

  const reg = await registerServiceWorker();
  if (!reg) return { state: "unsupported", endpoint: null };

  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return { state: "off", endpoint: null };

  // Il server deve confermare di conoscere questo endpoint: se il database è
  // stato ripulito (o le chiavi VAPID rigenerate) il browser resta convinto di
  // essere iscritto mentre non arriva più niente.
  try {
    const r = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
      cache: "no-store",
    });
    const d = (await r.json()) as { configured: boolean; subscribed: boolean };
    if (!d.configured) return { state: "unconfigured", endpoint: sub.endpoint };
    if (!d.subscribed) {
      // Iscrizione orfana: la si ripresenta al server invece di chiedere di
      // nuovo il permesso, che l'utente ha già dato.
      await postSubscription(sub);
    }
    return { state: "on", endpoint: sub.endpoint };
  } catch {
    return { state: "on", endpoint: sub.endpoint };
  }
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const r = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
  });
  return r.ok;
}

/** Chiede il permesso e iscrive il dispositivo. Va chiamata da un click. */
export async function enablePush(): Promise<{ ok: boolean; state: PushState; error?: string }> {
  if (iosNeedsInstall())
    return {
      ok: false,
      state: "ios-needs-install",
      error: "Su iPhone e iPad aggiungi prima l'app alla schermata Home.",
    };
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return { ok: false, state: "unsupported", error: "Questo browser non supporta le notifiche." };

  const info = await fetch("/api/push", { cache: "no-store" }).then((r) => r.json());
  if (!info?.configured || !info?.key)
    return { ok: false, state: "unconfigured", error: "Notifiche push non configurate sul server." };

  const perm = await Notification.requestPermission();
  if (perm !== "granted")
    return {
      ok: false,
      state: perm === "denied" ? "denied" : "off",
      error:
        perm === "denied"
          ? "Permesso negato. Riattivalo dalle impostazioni del browser per questo sito."
          : "Permesso non concesso.",
    };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, state: "unsupported", error: "Service worker non registrato." };
  // Su un worker appena installato pushManager non è pronto subito.
  await navigator.serviceWorker.ready;

  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true, // obbligatorio: niente push silenziosi
        applicationServerKey: urlBase64ToUint8Array(info.key) as BufferSource,
      }));
    const ok = await postSubscription(sub);
    return ok
      ? { ok: true, state: "on" }
      : { ok: false, state: "off", error: "Il server ha rifiutato l'iscrizione." };
  } catch (e) {
    return { ok: false, state: "off", error: e instanceof Error ? e.message : "Iscrizione fallita." };
  }
}

/** Disiscrive questo dispositivo (lascia il permesso del browser dov'è). */
export async function disablePush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return true;
    await fetch("/api/push", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe().catch(() => null);
    return true;
  } catch {
    return false;
  }
}

/** Manda una notifica di prova a questo utente (tutti i suoi dispositivi). */
export async function testPush(): Promise<boolean> {
  const r = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ test: true }),
  });
  const d = await r.json().catch(() => null);
  return !!d?.ok;
}
