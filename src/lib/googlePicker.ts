import "server-only";
import { prisma } from "./db";
import { getUserAccessToken, hasPickerScope } from "./google";
import { saveBytes } from "./uploads";
import crypto from "crypto";

/**
 * **Pescare una foto dal Google Foto dell'utente** e portarla nel fascicolo.
 *
 * È il verso opposto di `googlePhotos.ts` (che ci copia dentro le foto del
 * fascicolo) e usa un'API diversa, perché dal 2025 Google non lascia più a
 * un'app leggere la libreria di una persona: si apre una **sessione di
 * selezione**, l'utente sceglie gli scatti dentro Google Foto e l'app riceve
 * **soltanto quelli**. Il permesso è `photospicker.mediaitems.readonly`.
 *
 * Il giro, tutto lato server perché il token non deve mai arrivare al browser:
 *
 *  1. `createSession()` → `pickerUri`, che il browser apre in una finestra
 *     nuova (Google vieta l'iframe).
 *  2. il client richiama `sessionState()` ogni `pollInterval` finché
 *     `mediaItemsSet` non diventa vero: è l'utente che decide quando ha finito.
 *  3. `importPicked()` scarica i byte degli scatti scelti, li salva su disco e
 *     crea le righe `Photo` come un caricamento qualunque — da quel momento la
 *     foto è nel fascicolo e non dipende più da Google.
 *
 * I `baseUrl` scadono in **60 minuti** e vanno chiamati col token: per questo
 * lo scarico avviene subito, nella stessa richiesta che importa.
 */

const PICKER = "https://photospicker.googleapis.com/v1";
/** Tetto per scatto: una foto di cantiere sta sotto, un video no. */
const MAX_BYTES = 25 * 1024 * 1024;
/** Quante se ne importano in un colpo: oltre, la richiesta HTTP diventa lunga. */
const MAX_ITEMS = 30;

export type PickerSession = {
  sessionId: string;
  pickerUri: string;
  /** Millisecondi consigliati da Google fra un controllo e il successivo. */
  pollMs: number;
  /** Millisecondi dopo i quali smettere di controllare. */
  timeoutMs: number;
};

export type PickerError = { error: string; needsAuth?: boolean };

type ApiSession = {
  id?: string;
  pickerUri?: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
  error?: { message?: string };
};

type PickedItem = {
  id?: string;
  createTime?: string;
  mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string };
};

/** "3.5s" → 3500 ms. Formato Duration di Google, con default di cortesia. */
function durationMs(v: string | undefined, fallback: number): number {
  const n = Number(String(v ?? "").replace(/s$/, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : fallback;
}

/**
 * Token dell'utente + controllo del permesso. Il messaggio distingue "non hai
 * ancora autorizzato" (si risolve con un clic) da "l'account non c'è": sono due
 * problemi diversi e la UI propone due cose diverse.
 */
async function auth(userId: string): Promise<{ token: string; email: string } | PickerError> {
  const t = await getUserAccessToken(userId);
  // Anche "account non collegato" è `needsAuth`: il consenso di Google è lo
  // stesso passaggio, e mandare l'utente a cercarsi la pagina del profilo per
  // tornare qui dopo sarebbe un giro che non aggiunge niente.
  if (!t) return { error: "Collega il tuo account Google per scegliere da Google Foto.", needsAuth: true };
  if (!(await hasPickerScope(userId)))
    return { error: "Devi autorizzare l'accesso al tuo Google Foto.", needsAuth: true };
  return t;
}

const isErr = (x: unknown): x is PickerError => !!x && typeof x === "object" && "error" in x;

/** Apre una sessione di selezione e ritorna il link da far aprire all'utente. */
export async function createSession(userId: string): Promise<PickerSession | PickerError> {
  const a = await auth(userId);
  if (isErr(a)) return a;

  const res = await fetch(`${PICKER}/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" },
    body: "{}",
  });
  const d = (await res.json().catch(() => ({}))) as ApiSession;
  if (!res.ok || !d.id || !d.pickerUri)
    return { error: d.error?.message || `Google Foto non risponde (HTTP ${res.status})` };

  return {
    sessionId: d.id,
    // `/autoclose`: finita la scelta la finestra si chiude da sola, invece di
    // lasciare l'utente dentro Google Foto a chiedersi se ha finito.
    pickerUri: `${d.pickerUri}/autoclose`,
    pollMs: durationMs(d.pollingConfig?.pollInterval, 3000),
    timeoutMs: durationMs(d.pollingConfig?.timeoutIn, 10 * 60 * 1000),
  };
}

/** L'utente ha finito di scegliere? */
export async function sessionState(
  userId: string,
  sessionId: string
): Promise<{ ready: boolean; pollMs: number } | PickerError> {
  const a = await auth(userId);
  if (isErr(a)) return a;

  const res = await fetch(`${PICKER}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${a.token}` },
  });
  const d = (await res.json().catch(() => ({}))) as ApiSession;
  if (!res.ok) return { error: d.error?.message || `Sessione non valida (HTTP ${res.status})` };
  return { ready: !!d.mediaItemsSet, pollMs: durationMs(d.pollingConfig?.pollInterval, 3000) };
}

/** Chiude la sessione: Google ne consente poche aperte per volta. */
async function closeSession(token: string, sessionId: string) {
  await fetch(`${PICKER}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
}

const extOf = (mime: string, filename: string) => {
  const fromName = /\.(jpe?g|png|webp|heic|heif)$/i.exec(filename)?.[0];
  if (fromName) return fromName.toLowerCase();
  return mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
};

/**
 * Scarica gli scatti scelti e li mette nel fascicolo. Ritorna quante foto sono
 * entrate e, se qualcuna è rimasta fuori, il perché: un video o un file troppo
 * grande non devono far fallire l'importazione degli altri.
 */
export async function importPicked(opts: {
  userId: string;
  userName: string;
  sessionId: string;
  machineId: string;
  machineCode: string;
  category: string;
  componentItemId?: string | null;
}): Promise<{ photoIds: string[]; skipped: string[] } | PickerError> {
  const a = await auth(opts.userId);
  if (isErr(a)) return a;

  const res = await fetch(`${PICKER}/mediaItems?sessionId=${encodeURIComponent(opts.sessionId)}&pageSize=${MAX_ITEMS}`, {
    headers: { authorization: `Bearer ${a.token}` },
  });
  const d = (await res.json().catch(() => ({}))) as { mediaItems?: PickedItem[]; error?: { message?: string } };
  if (!res.ok) return { error: d.error?.message || `Scelta non recuperata (HTTP ${res.status})` };

  const items = (d.mediaItems ?? []).slice(0, MAX_ITEMS);
  if (!items.length) return { error: "Non hai scelto nessuna foto." };

  const photoIds: string[] = [];
  const skipped: string[] = [];

  for (const it of items) {
    const file = it.mediaFile;
    const name = file?.filename || "foto";
    const mime = file?.mimeType || "";
    if (!file?.baseUrl || !mime.startsWith("image/")) {
      skipped.push(`${name}: non è una foto`);
      continue;
    }
    try {
      // `=d` scarica l'originale con i suoi dati Exif (senza la posizione).
      // Il token serve anche qui: i baseUrl della Picker API non sono pubblici.
      const bin = await fetch(`${file.baseUrl}=d`, { headers: { authorization: `Bearer ${a.token}` } });
      if (!bin.ok) throw new Error(`HTTP ${bin.status}`);
      const bytes = new Uint8Array(await bin.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) {
        skipped.push(`${name}: troppo grande`);
        continue;
      }
      const path = await saveBytes(
        bytes,
        `${opts.machineCode}/foto`,
        `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${extOf(mime, name)}`
      );
      const photo = await prisma.photo.create({
        data: {
          machineId: opts.machineId,
          componentItemId: opts.componentItemId ?? null,
          path,
          category: opts.category,
          caption: null,
          takenAt: it.createTime ? new Date(it.createTime) : undefined,
          authorName: opts.userName,
          authorId: opts.userId,
          // Viene di là: segnarla come già presente su Google Foto evita che il
          // backup la rispedisca creando un doppione nella libreria
          // dell'utente. Il prefisso dice che è l'id dello scatto **scelto**,
          // non quello di un media creato da noi: sono due numerazioni diverse
          // e confonderle significherebbe credere di poterlo richiamare.
          gphotoId: `picked:${it.id ?? crypto.randomUUID()}`,
          gphotoAt: new Date(),
          gphotoAccount: a.email,
        },
      });
      photoIds.push(photo.id);
    } catch (e) {
      skipped.push(`${name}: ${e instanceof Error ? e.message : "scarico non riuscito"}`);
    }
  }

  await closeSession(a.token, opts.sessionId);
  if (!photoIds.length) return { error: skipped[0] ?? "Nessuna foto importata" };
  return { photoIds, skipped };
}
