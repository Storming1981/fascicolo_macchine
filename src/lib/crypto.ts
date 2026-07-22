import "server-only";
import crypto from "crypto";

/**
 * Cifratura simmetrica dei segreti salvati a DB (es. token OAuth Google).
 * AES-256-GCM con chiave derivata via scrypt da GOOGLE_TOKEN_ENC_KEY (o, in
 * mancanza, da AUTH_SECRET). Formato: "v1:<iv>:<tag>:<ciphertext>" in base64.
 *
 * NB: cambiando la chiave i valori già cifrati diventano illeggibili (basta
 * ricollegare l'account Google).
 */

const SALT = "ft-secret-v1"; // salt fisso: la chiave deve essere riproducibile

function key(): Buffer {
  const secret = process.env.GOOGLE_TOKEN_ENC_KEY || process.env.AUTH_SECRET || "dev-secret-change-me";
  return crypto.scryptSync(secret, SALT, 32);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(enc: string | null | undefined): string | null {
  if (!enc || !enc.startsWith("v1:")) return null;
  try {
    const [, ivB64, tagB64, ctB64] = enc.split(":");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    d.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
  } catch {
    return null; // chiave cambiata o valore corrotto
  }
}
