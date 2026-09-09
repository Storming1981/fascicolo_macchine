import path from "path";

/**
 * Radice dei file caricati. Vive in un modulo separato (senza `server-only`)
 * perche' serve anche agli script di manutenzione da riga di comando, che
 * girano in Node puro e non passano dal bundler di Next.
 */
export const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");

/** Path su disco di un file salvato, dal suo path pubblico /uploads/... */
export function uploadLocalPath(publicPath: string): string {
  return path.join(UPLOAD_ROOT, publicPath.replace(/^\/uploads\//, ""));
}
