/**
 * Import operatori dal timbratore (matricola + badge RFID) come User ZATO.
 * Sorgente: CSV con header (delimitatore ';'):
 *   matricola;badge;nome;cognome;username;email;ruolo;reparto
 * Default: scripts/operators.csv  (override: `npm run operators:import -- path.csv`)
 *
 * - match su email → matricola → badge (aggiorna se esiste, crea altrimenti);
 * - nuovi utenti: password di default "zato2026" (da cambiare), attivi;
 * - salta righe @servonet.it (account esterni) e senza badge/matricola.
 * - ruolo: "Supervisore*"→CAPO_OFFICINA, "Administrator"→ADMIN,
 *   "Administrator visite"→CAPO_OFFICINA, altrimenti TECNICO_CAMPO.
 */

import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import type { Role } from "@prisma/client";

const DEFAULT_PASSWORD = "zato2026";

function mapRole(ruolo: string): Role {
  const r = ruolo.trim().toLowerCase();
  if (r.includes("supervisore")) return "CAPO_OFFICINA";
  if (r === "administrator") return "ADMIN";
  if (r.includes("administrator")) return "CAPO_OFFICINA";
  return "TECNICO_CAMPO";
}

async function main() {
  const file = process.argv[2] || path.join("scripts", "operators.csv");
  console.log(`👷 Import operatori da ${file}…\n`);
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift();
  if (!header) throw new Error("CSV vuoto");

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const line of lines) {
    const [matricola, badge, nome, cognome, username, email, ruolo] = line.split(";").map((s) => s.trim());
    if (!badge && !matricola) {
      skipped++;
      continue;
    }
    if (email && email.toLowerCase().endsWith("@servonet.it")) {
      skipped++;
      continue;
    }
    const name = `${nome ?? ""} ${cognome ?? ""}`.trim() || username || `Operatore ${matricola}`;
    const mail = (email && email.includes("@") ? email : `${matricola || username || "op"}@timbratore.local`).toLowerCase();
    const role = mapRole(ruolo ?? "");

    // match esistente: email → matricola → badge
    const existing =
      (await prisma.user.findUnique({ where: { email: mail } })) ??
      (matricola ? await prisma.user.findFirst({ where: { matricola } }) : null) ??
      (badge ? await prisma.user.findFirst({ where: { badgeId: badge } }) : null);

    try {
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            matricola: matricola || existing.matricola,
            badgeId: badge || existing.badgeId,
            name: existing.name || name,
          },
        });
        updated++;
        console.log(`  ~ ${name} (mat ${matricola} · badge ${badge})`);
      } else {
        await prisma.user.create({
          data: {
            name,
            email: mail,
            passwordHash,
            role,
            matricola: matricola || null,
            badgeId: badge || null,
            active: true,
          },
        });
        created++;
        console.log(`  + ${name} (mat ${matricola} · badge ${badge}) [${role}]`);
      }
    } catch (e) {
      skipped++;
      console.log(`  ! salto ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }

  console.log(`\n✅ Operatori — creati: ${created} · aggiornati: ${updated} · saltati: ${skipped}`);
  console.log(`   Password di default per i nuovi: "${DEFAULT_PASSWORD}" (da cambiare).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
