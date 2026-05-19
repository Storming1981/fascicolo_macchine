import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");

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

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
