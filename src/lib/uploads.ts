import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

import { UPLOAD_ROOT as ROOT, uploadLocalPath } from "./uploadPath";

export { uploadLocalPath };

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function safeSegment(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Salva un File (multipart) sotto uploads/<scope>/ e ritorna il path pubblico /uploads/... */
export async function saveFile(file: File, scope: string): Promise<{ path: string; size: number }> {
  const dir = path.join(ROOT, safeSegment(scope));
  await ensureDir(dir);
  const ext = path.extname(file.name) || "";
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, name), buf);
  return { path: `/uploads/${safeSegment(scope)}/${name}`, size: buf.length };
}

/**
 * Salva un flusso di byte su disco SENZA tenerlo in memoria.
 *
 * `req.formData()` bufferizza l'intero corpo della richiesta: va benissimo per
 * un PDF da 10 MB, fa esplodere il container su un video di mezzo giga. Qui i
 * byte passano dalla rete al disco a blocchi, con un tetto che interrompe la
 * scrittura (e cancella il parziale) appena viene superato.
 */
export async function saveStream(
  body: ReadableStream<Uint8Array>,
  scope: string,
  filename: string,
  maxBytes: number
): Promise<{ path: string; size: number } | { error: string }> {
  const { Readable } = await import("stream");
  const { createWriteStream } = await import("fs");
  const { pipeline } = await import("stream/promises");

  const dir = path.join(ROOT, safeSegment(scope));
  await ensureDir(dir);
  const ext = path.extname(filename).slice(0, 12) || "";
  const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeSegment(ext)}`;
  const full = path.join(dir, name);

  let size = 0;
  let troppoGrande = false;
  const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);

  try {
    await pipeline(
      source,
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const c of chunks) {
          size += c.length;
          if (size > maxBytes) {
            troppoGrande = true;
            // Interrompere qui evita di scrivere gigabyte solo per poi rifiutarli.
            throw new Error("oltre il limite");
          }
          yield c;
        }
      },
      createWriteStream(full)
    );
  } catch (e) {
    await fs.unlink(full).catch(() => {});
    if (troppoGrande) return { error: `File troppo grande (massimo ${Math.round(maxBytes / 1024 / 1024)} MB)` };
    return { error: e instanceof Error ? e.message : "Errore durante il caricamento" };
  }

  return { path: `/uploads/${safeSegment(scope)}/${name}`, size };
}

/** Salva una dataURL (es. firma a penna PNG base64) e ritorna il path pubblico. */
export async function saveDataUrl(dataUrl: string, scope: string, prefix = "sig"): Promise<string> {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error("dataURL non valida");
  const ext = m[1].split("/")[1] === "jpeg" ? "jpg" : m[1].split("/")[1];
  const dir = path.join(ROOT, safeSegment(scope));
  await ensureDir(dir);
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
  await fs.writeFile(path.join(dir, name), Buffer.from(m[2], "base64"));
  return `/uploads/${safeSegment(scope)}/${name}`;
}

/** Salva byte grezzi (es. PDF generato) sotto uploads/<scope>/ e ritorna il path pubblico. */
export async function saveBytes(
  bytes: Uint8Array,
  scope: string,
  filename: string
): Promise<string> {
  const dir = path.join(ROOT, safeSegment(scope));
  await ensureDir(dir);
  const name = safeSegment(filename);
  await fs.writeFile(path.join(dir, name), Buffer.from(bytes));
  return `/uploads/${safeSegment(scope)}/${name}`;
}

/** Rilegge un file salvato (path pubblico /uploads/...) come data URL (per riuso, es. firma in PDF). */
export async function readUploadAsDataUrl(publicPath: string | null | undefined): Promise<string | null> {
  if (!publicPath || !publicPath.startsWith("/uploads/")) return null;
  try {
    const rel = publicPath.replace(/^\/uploads\//, "");
    const file = path.join(ROOT, rel);
    const buf = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase().replace(".", "");
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Rilegge un file salvato (/uploads/...) come byte grezzi + mime (per allegati email). */
export async function readUploadBytes(
  publicPath: string | null | undefined
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!publicPath || !publicPath.startsWith("/uploads/")) return null;
  try {
    const rel = publicPath.replace(/^\/uploads\//, "");
    const file = path.join(ROOT, rel);
    const bytes = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase().replace(".", "");
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "pdf"
              ? "application/pdf"
              : "application/octet-stream";
    return { bytes, mime };
  } catch {
    return null;
  }
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
