/**
 * Genera una API key per il sync-agent ERP.
 *
 *   npx tsx scripts/gen-sync-key.ts
 *
 * La stessa chiave va messa in DUE posti:
 *   - VPS:  .env.production  ->  SYNC_API_KEY=sk_sync_...
 *   - Agent (PC aziendale): sync-agent/.env  ->  SYNC_API_KEY=sk_sync_...
 *
 * La piattaforma la confronta in modo timing-safe (src/lib/syncAuth.ts): non
 * viene memorizzata da nessun'altra parte, quindi se la perdi ne rigeneri una
 * nuova e aggiorni entrambi i file.
 */
import { randomBytes } from "crypto";

const key = "sk_sync_" + randomBytes(32).toString("base64url");

console.log("\nAPI key generata (copiala in entrambi i .env):\n");
console.log("  SYNC_API_KEY=" + key + "\n");
