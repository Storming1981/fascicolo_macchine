// Caricatore .env senza dipendenze esterne.
// Legge il file .env nella cwd e popola process.env.

import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env');

try {
  if (!fs.existsSync(envPath)) {
    console.warn(`[env-loader] File .env non trovato in ${envPath}`);
  } else {
    const content = fs.readFileSync(envPath, 'utf-8');
    const clean = content.replace(/^﻿/, '');
    const lines = clean.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
} catch (error) {
  console.error('[env-loader] Errore lettura .env:', error);
}
