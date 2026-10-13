import { prisma } from "./db";
import { getUserAccessToken, hasPhotoScope } from "./google";
import { readUploadBytes } from "./uploads";

/**
 * Backup delle foto su **Google Foto dell'account personale di chi le scatta**.
 *
 * La piattaforma resta la fonte: il file sta sul disco del server e nel
 * fascicolo. Questa è una copia in più, chiesta dal committente, e per questo
 * non deve mai poter far fallire il caricamento di una foto: gira dopo la
 * risposta HTTP (`after()` nelle route) e un errore finisce su `Photo.gphotoError`
 * invece di propagarsi.
 *
 * Perché l'account personale e non uno aziendale: la foto la scatta un
 * operatore col suo telefono, il backup serve a lui. L'album nasce nel suo
 * account, quindi l'id album vale per (utente, fascicolo) — da qui `GphotoAlbum`.
 *
 * Permesso: `photoslibrary.appendonly`, cioè l'app può creare album e caricare
 * ma **non può leggere** la libreria dell'utente. È opt-in: `User.photoBackup`
 * più il consenso a quel permesso (gli altri scope restano quelli della posta).
 */

const UPLOAD_URL = "https://photoslibrary.googleapis.com/v1/uploads";
const BATCH_URL = "https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate";
const ALBUMS_URL = "https://photoslibrary.googleapis.com/v1/albums";

const mimeOf = (p: string) =>
  /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg";

/** Album del fascicolo nell'account dell'utente: si crea una volta sola. */
async function ensureAlbum(token: string, userId: string, machineId: string, title: string): Promise<string | null> {
  const known = await prisma.gphotoAlbum.findUnique({ where: { userId_machineId: { userId, machineId } } });
  if (known) return known.albumId;

  const res = await fetch(ALBUMS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ album: { title } }),
  });
  const d = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !d.id) throw new Error(d.error?.message || `Album non creato (HTTP ${res.status})`);

  await prisma.gphotoAlbum.create({ data: { userId, machineId, albumId: d.id, title } });
  return d.id;
}

/** Carica i byte e ritorna l'upload token (passo 1 di 2 dell'API). */
async function uploadBytes(token: string, bytes: Buffer, filename: string, mime: string): Promise<string> {
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "X-Goog-Upload-Content-Type": mime,
      "X-Goog-Upload-Protocol": "raw",
      "X-Goog-Upload-File-Name": filename,
    },
    body: new Uint8Array(bytes),
  });
  const text = (await res.text()).trim();
  if (!res.ok || !text) throw new Error(`Caricamento non riuscito (HTTP ${res.status})`);
  return text;
}

/**
 * Copia su Google Foto le foto indicate. Idempotente: salta quelle che hanno
 * già un `gphotoId` e quelle il cui autore non ha attivato il backup.
 * Non lancia mai: ogni errore resta scritto sulla riga della foto.
 */
export async function backupPhotos(photoIds: string[]): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  if (!photoIds.length) return { done, failed };

  const photos = await prisma.photo.findMany({
    where: { id: { in: photoIds }, gphotoId: null, deletedAt: null, authorId: { not: null } },
    select: {
      id: true,
      path: true,
      caption: true,
      category: true,
      authorId: true,
      machineId: true,
      machine: { select: { code: true, customer: true } },
      componentItem: { select: { label: true } },
      intervento: { select: { code: true } },
    },
  });
  if (!photos.length) return { done, failed };

  // Token e permessi per autore: le foto di un caricamento sono quasi sempre
  // dello stesso utente, quindi un giro solo di controlli.
  const byUser = new Map<string, typeof photos>();
  for (const p of photos) byUser.set(p.authorId!, [...(byUser.get(p.authorId!) ?? []), p]);

  for (const [userId, list] of byUser) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { photoBackup: true, name: true } });
    if (!user?.photoBackup) continue;

    let token: string;
    let account: string;
    try {
      if (!(await hasPhotoScope(userId))) throw new Error("Permesso Google Foto non concesso: ricollega l'account");
      const t = await getUserAccessToken(userId);
      if (!t) throw new Error("Nessun account Google collegato");
      token = t.token;
      account = t.email;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Backup non riuscito";
      await prisma.photo.updateMany({ where: { id: { in: list.map((p) => p.id) } }, data: { gphotoError: error } });
      failed += list.length;
      continue;
    }

    for (const p of list) {
      try {
        const file = await readUploadBytes(p.path);
        if (!file) throw new Error("File non trovato sul server");
        const album = p.machineId
          ? await ensureAlbum(
              token,
              userId,
              p.machineId,
              `ZATO ${p.machine?.code ?? ""}${p.machine?.customer ? ` — ${p.machine.customer}` : ""}`.trim()
            )
          : null;

        const name = p.path.split("/").pop() || `${p.id}.jpg`;
        const uploadToken = await uploadBytes(token, file.bytes, name, mimeOf(p.path));
        // La descrizione è l'unico posto in cui, dentro Google Foto, si capisce
        // a che cosa serve lo scatto: slot, intervento, cartella.
        const description = [
          p.machine?.code,
          p.componentItem?.label,
          p.intervento?.code,
          p.caption,
          p.category,
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 900);

        const res = await fetch(BATCH_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            ...(album ? { albumId: album } : {}),
            newMediaItems: [{ description, simpleMediaItem: { uploadToken, fileName: name } }],
          }),
        });
        const d = (await res.json().catch(() => ({}))) as {
          newMediaItemResults?: { status?: { message?: string; code?: number }; mediaItem?: { id?: string } }[];
          error?: { message?: string };
        };
        const r = d.newMediaItemResults?.[0];
        const id = r?.mediaItem?.id;
        if (!res.ok || !id)
          throw new Error(r?.status?.message || d.error?.message || `Creazione non riuscita (HTTP ${res.status})`);

        await prisma.photo.update({
          where: { id: p.id },
          data: { gphotoId: id, gphotoAt: new Date(), gphotoAccount: account, gphotoError: null },
        });
        done++;
      } catch (e) {
        await prisma.photo.update({
          where: { id: p.id },
          data: { gphotoError: (e instanceof Error ? e.message : "Backup non riuscito").slice(0, 300) },
        });
        failed++;
      }
    }
  }
  return { done, failed };
}

/**
 * Foto non ancora copiate degli utenti che hanno il backup attivo (comprese
 * quelle scattate prima di attivarlo). La usa lo script `gphoto:retry`.
 */
export async function pendingBackupPhotoIds(limit = 200): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { photoBackup: true }, select: { id: true } });
  if (!users.length) return [];
  const rows = await prisma.photo.findMany({
    where: { gphotoId: null, deletedAt: null, authorId: { in: users.map((u) => u.id) } },
    orderBy: { takenAt: "desc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
