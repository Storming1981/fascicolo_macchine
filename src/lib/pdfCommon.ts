import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { rgb } from "pdf-lib";

// Pezzi comuni ai PDF su carta intestata ZATO (rapportino giornaliero e
// riepilogo intervento): colori, carta intestata e normalizzazione del testo.

export const NAVY = rgb(0.06, 0.2, 0.36);
export const GREY = rgb(0.42, 0.45, 0.5);
export const INK = rgb(0.1, 0.12, 0.15);
export const LINE = rgb(0.85, 0.87, 0.9);
export const ZEBRA = rgb(0.96, 0.97, 0.98);
export const TRAVEL = rgb(0.72, 0.33, 0.03); // ambra: ore di viaggio

export const A4 = [595.28, 841.89] as const;
export const MARGIN = 48;

/** Timbratura di viaggio (tipologia letta dal timbratore). */
export const isTravel = (t?: string | null) => /viagg/i.test(t ?? "");

/** Carica (best-effort) le immagini della carta intestata ZATO. */
export async function loadLetterhead(): Promise<{ header?: Buffer; footer?: Buffer }> {
  const dir = path.resolve(process.cwd(), "public", "letterhead");
  const out: { header?: Buffer; footer?: Buffer } = {};
  try {
    out.header = await fs.readFile(path.join(dir, "header.jpg"));
  } catch {}
  try {
    out.footer = await fs.readFile(path.join(dir, "footer.jpg"));
  } catch {}
  return out;
}

/** Normalizza il testo per la codifica WinAnsi di pdf-lib. */
export function san(s: string): string {
  return (s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^ -ÿ]/g, "?");
}
