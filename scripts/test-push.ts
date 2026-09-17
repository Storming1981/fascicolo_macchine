/**
 * Prova del canale Web Push SENZA browser.
 *
 *   npm run push:test
 *
 * Non fa comparire una notifica sul telefono (per quella ci vuole un
 * dispositivo vero): verifica la parte che si puo' sbagliare in silenzio —
 * firma VAPID, cifratura del payload, lettura delle iscrizioni dal database e
 * rimozione automatica di quelle morte. Se questa passa e sul telefono non
 * arriva niente, il problema sta nel permesso del browser o nel proxy, non qui.
 *
 * Due parti:
 *  1. `generateRequestDetails` costruisce la richiesta senza spedirla: e' il
 *     modo di guardare headers e payload cifrato senza tirare su un server TLS
 *     (web-push parla HTTPS e basta: contro un listener in chiaro da EPROTO).
 *  2. Un finto push service HTTPS che risponde 410 per controllare che
 *     l'iscrizione morta venga cancellata da sola.
 */
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import webpush from "web-push";
import { prisma } from "../src/lib/db";
import { sendPushToUser, isPushConfigured } from "../src/lib/push";

const PORT = 4555;

/** Coppia ECDH P-256 come quella che genererebbe il browser. */
function clientKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: crypto.randomBytes(16).toString("base64url"),
  };
}

function selfSigned(dir: string) {
  const key = path.join(dir, "k.pem");
  const cert = path.join(dir, "c.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function main() {
  if (!isPushConfigured()) {
    console.log("VAPID non configurato: metti VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env");
    return;
  }
  const user = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (!user) {
    console.log("Serve un utente admin attivo.");
    return;
  }
  const keys = clientKeys();

  /* ── 1. Richiesta costruita davvero (senza spedirla) ───────────── */
  const det = webpush.generateRequestDetails(
    { endpoint: "https://fcm.googleapis.com/fcm/send/prova", keys },
    JSON.stringify({ title: "Sei il capo cantiere di INT-0000", body: "Prova", url: "/notifiche" }),
    { TTL: 86400 }
  );
  const auth = String(det.headers["Authorization"] ?? "");
  const body = det.body as Buffer;
  console.log("1) Richiesta push costruita");
  console.log("   endpoint       :", det.endpoint);
  console.log("   firma VAPID    :", auth.startsWith("vapid") ? "presente" : "MANCANTE");
  console.log("   content-encoding:", det.headers["Content-Encoding"], "(atteso aes128gcm)");
  console.log("   payload cifrato:", body?.length ?? 0, "byte");
  const leaks = body ? body.includes(Buffer.from("capo cantiere")) : false;
  console.log("   testo in chiaro nel payload:", leaks ? "SI — PROBLEMA" : "no (cifrato)");

  /* ── 2. Iscrizione morta: 410 → la riga deve sparire ───────────── */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zato-push-"));
  const { key, cert } = selfSigned(dir);
  const server = https.createServer({ key, cert }, (_q, s) => s.writeHead(410).end());
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));

  const endpoint = `https://127.0.0.1:${PORT}/push/prova`;
  await prisma.pushSubscription.create({
    data: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: "test" },
  });

  // Il certificato e' autofirmato: solo per questa prova.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  await sendPushToUser(user.id, { title: "x", body: "y" });
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });

  const left = await prisma.pushSubscription.count({ where: { endpoint } });
  console.log("\n2) Iscrizione morta (410)");
  console.log("   rimossa automaticamente:", left === 0 ? "SI" : `NO — ne restano ${left}`);

  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
