import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { fmtDate, fmtDateTime } from "./format";
import {
  MATRICOLA_LABEL,
  sheetCtx,
  sheetDef,
  visibleRows,
  type SheetHeader,
  type SheetKind,
  type SheetValues,
} from "./allestimento";

// Riproduce l'impaginato dei moduli cartacei M5.16 / M5.17: intestazione con
// logo e codice modulo, tabella Voce | Specifica | Matricola | Note, piede con
// data, compilatore e firma.

export type AllestimentoPdfInput = {
  kind: SheetKind;
  machineCode: string;
  commessa: string;
  country: string;
  model: string;
  header: SheetHeader;
  values: SheetValues;
  components: { groupId: string; serials: string[] }[];
  compilerName: string | null;
  compiledAt: Date | null;
  compilerSignature: string | null;
};

const NAVY = rgb(0.08, 0.2, 0.36);
const INK = rgb(0.1, 0.12, 0.15);
const GREY = rgb(0.42, 0.45, 0.5);
const GRID = rgb(0.35, 0.38, 0.42);
const SECTION_BG = rgb(0.93, 0.95, 0.97);

const A4: [number, number] = [595.28, 841.89];
// Misure tarate perché ogni scheda stia in una pagina come il modulo cartaceo.
const M = 24;
const TW = A4[0] - 2 * M;
// Colonne: voce | specifica | matricola | note
const COLS = [TW * 0.36, TW * 0.25, TW * 0.19, TW * 0.2];
const COLX = [M, M + COLS[0], M + COLS[0] + COLS[1], M + COLS[0] + COLS[1] + COLS[2]];
const FS = 7;
const LINE_H = 11.5;

function san(s: string): string {
  return (s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^ -ÿ]/g, "?");
}

function wrap(text: string, f: PDFFont, size: number, maxW: number): string[] {
  const words = san(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (f.widthOfTextAtSize(t, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

async function embedDataUrl(doc: PDFDocument, dataUrl: string | null): Promise<PDFImage | null> {
  if (!dataUrl?.startsWith("data:image")) return null;
  try {
    const bytes = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
    return dataUrl.includes("image/jpeg") ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

const fmtDay = (d: Date) => fmtDate(d);

export async function generateAllestimentoPdf(input: AllestimentoPdfInput): Promise<Uint8Array> {
  const def = sheetDef(input.kind);
  const ctx = sheetCtx(input.kind, input.header, input.model);
  const doc = await PDFDocument.create();
  doc.setTitle(`${def.code} ${def.title} - ${input.commessa}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let logo: PDFImage | null = null;
  try {
    logo = await doc.embedPng(await fs.readFile(path.resolve(process.cwd(), "public", "zato-logo-blue.png")));
  } catch {
    /* logo facoltativo */
  }
  const signature = await embedDataUrl(doc, input.compilerSignature);

  let page!: PDFPage;
  let y = 0;
  const bottom = M + 12;

  const cellText = (
    s: string,
    x: number,
    w: number,
    top: number,
    h: number,
    opts: { f?: PDFFont; size?: number; align?: "left" | "center"; color?: typeof INK } = {}
  ) => {
    const f = opts.f ?? font;
    const size = opts.size ?? FS;
    const lines = wrap(s, f, size, w - 8);
    const lh = size + 2;
    let ty = top - h / 2 + (lines.length * lh) / 2 - size + 1;
    for (const ln of lines) {
      const tw = f.widthOfTextAtSize(ln, size);
      const tx = opts.align === "center" ? x + (w - tw) / 2 : x + 4;
      page.drawText(ln, { x: tx, y: ty, size, font: f, color: opts.color ?? INK });
      ty -= lh;
    }
  };
  const box = (x: number, top: number, w: number, h: number, fill?: typeof NAVY) =>
    page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: GRID, borderWidth: 0.5, color: fill });

  const titleBlock = () => {
    const h = 42;
    const top = A4[1] - M;
    box(M, top, 96, h);
    if (logo) {
      const lh = 22;
      const lw = Math.min(80, (logo.width / logo.height) * lh);
      page.drawImage(logo, { x: M + (96 - lw) / 2, y: top - h / 2 - lh / 2, width: lw, height: lh });
    }
    box(M + 96, top, TW - 96 - 76, h);
    cellText(def.title, M + 96, TW - 96 - 76, top, h, { f: bold, size: 10, align: "center" });
    box(A4[0] - M - 76, top, 76, h, NAVY);
    cellText(def.code, A4[0] - M - 76, 76, top, h, { f: bold, size: 11, align: "center", color: rgb(1, 1, 1) });
    const rev = san(def.rev);
    page.drawText(rev, {
      x: A4[0] - M - italic.widthOfTextAtSize(rev, 6.5),
      y: top - h - 8,
      size: 6.5,
      font: italic,
      color: GREY,
    });
    y = top - h - 12;
  };

  const headerTable = () => {
    const rh = 15;
    const w = [TW * 0.17, TW * 0.2, TW * 0.17, TW * 0.46];
    const fields = def.headerFields ?? [];
    const second: [string, string] = fields.includes("matricola")
      ? [`${(MATRICOLA_LABEL[def.kind] ?? "Matricola").toUpperCase()}:`, input.header.matricola ?? ""]
      : ["COLLAUDATO DA:", input.header.collaudatoDa ?? ""];
    const rows: [string, string, string, string][] = [
      ["COMMESSA:", input.commessa, `${def.typeLabel}:`, input.header.tipo ?? ""],
      ["PAESE DESTINAZIONE:", input.country, second[0], second[1]],
    ];
    for (const r of rows) {
      let x = M;
      r.forEach((t, i) => {
        box(x, y, w[i], rh);
        cellText(t, x, w[i], y, rh, i % 2 === 0 ? { f: bold, size: 7 } : { align: "center" });
        x += w[i];
      });
      y -= rh;
    }
    y -= 8;
  };

  const newPage = (first: boolean) => {
    page = doc.addPage(A4);
    if (first) {
      titleBlock();
      headerTable();
    } else {
      y = A4[1] - M;
      page.drawText(san(`${def.code} ${def.title} — commessa ${input.commessa} (segue)`), {
        x: M,
        y: y - 9,
        size: 8,
        font: bold,
        color: NAVY,
      });
      y -= 18;
    }
  };

  const sectionHead = (title: string, subtitle?: string) => {
    const h = subtitle ? 22 : 15;
    const labels = [title, "SPECIFICA", "MATRICOLA", "NOTE"];
    labels.forEach((t, i) => {
      box(COLX[i], y, COLS[i], h, SECTION_BG);
      if (i === 0 && subtitle) {
        page.drawText(san(t), { x: COLX[0] + 4, y: y - 9.5, size: 7.5, font: bold, color: NAVY });
        page.drawText(san(subtitle), { x: COLX[0] + 4, y: y - 18, size: 5.5, font: italic, color: GREY });
      } else cellText(t, COLX[i], COLS[i], y, h, { f: bold, size: 7.5, color: NAVY });
    });
    y -= h;
  };

  newPage(true);

  for (const section of def.sections) {
    const rows = visibleRows(section, ctx);
    if (!rows.length) continue;
    // la testata di sezione non resta orfana in fondo alla pagina
    if (y - 22 - LINE_H < bottom) newPage(false);
    sectionHead(section.title, section.subtitle);

    for (const row of rows) {
      const v = input.values[row.key] ?? {};
      const serials = row.serials
        ? input.components.find((c) => c.groupId === row.serials)?.serials ?? []
        : row.serialField || row.serialList
        ? [v.serial ?? ""]
        : [];
      const subRows = Math.max(1, serials.length);
      const specW = row.wide ? COLS[1] + COLS[2] : COLS[1];
      const textLines = Math.max(
        wrap(row.label, font, FS, COLS[0] - 8).length,
        wrap(v.spec ?? "", font, FS, specW - 8).length,
        wrap(v.note ?? "", font, FS, COLS[3] - 8).length
      );
      const h = Math.max(subRows * LINE_H, textLines * (FS + 2) + 2.5);

      if (y - h < bottom) {
        newPage(false);
        sectionHead(section.title, section.subtitle);
      }

      box(COLX[0], y, COLS[0], h);
      cellText(row.label, COLX[0], COLS[0], y, h);
      box(COLX[1], y, specW, h);
      cellText(v.spec ?? "", COLX[1], specW, y, h, { align: "center" });
      if (!row.wide) {
        const sh = h / subRows;
        for (let i = 0; i < subRows; i++) {
          box(COLX[2], y - i * sh, COLS[2], sh);
          if (serials[i]) cellText(serials[i], COLX[2], COLS[2], y - i * sh, sh, { align: "center" });
        }
      }
      box(COLX[3], y, COLS[3], h);
      cellText(v.note ?? "", COLX[3], COLS[3], y, h);
      y -= h;
    }
  }

  // Piede: data, compilatore, firma
  const fh = 44;
  if (y - fh - 4 < bottom) newPage(false);
  y -= 4;
  box(M, y, TW, fh);
  const mid = y - fh / 2 - 3;
  const lbl = (t: string, x: number) => {
    page.drawText(san(t), { x, y: mid, size: 7, font: bold, color: NAVY });
    return x + bold.widthOfTextAtSize(san(t), 7) + 4;
  };
  let x = lbl("SCHEDA COMPILATA IL:", M + 8);
  page.drawText(input.compiledAt ? fmtDay(input.compiledAt) : "____________", { x, y: mid, size: 7.5, font, color: INK });
  x = lbl("SCHEDA COMPILATA DA:", M + 150);
  page.drawText(san(input.compilerName ?? "______________________"), { x, y: mid, size: 7.5, font, color: INK });
  x = lbl("FIRMA COMPILATORE:", M + 340);
  if (signature) {
    const sh = fh - 8;
    const sw = Math.min(A4[0] - M - 6 - x, (signature.width / signature.height) * sh);
    page.drawImage(signature, { x, y: y - fh + 4, width: sw, height: sh });
  } else {
    page.drawLine({ start: { x, y: mid - 2 }, end: { x: A4[0] - M - 10, y: mid - 2 }, thickness: 0.5, color: GRID });
  }

  // Riga di servizio su ogni pagina
  const pages = doc.getPages();
  const stamp = `Fascicolo ${input.machineCode} · generato il ${fmtDateTime(new Date())}`;
  pages.forEach((p, i) => {
    const t = [
      `${def.code} ${def.title.charAt(0)}${def.title.slice(1).toLowerCase()}`,
      `Pagina ${i + 1} di ${pages.length}`,
      stamp,
    ].map(san);
    p.drawText(t[0], { x: M, y: M - 12, size: 6, font, color: GREY });
    p.drawText(t[1], { x: A4[0] / 2 - font.widthOfTextAtSize(t[1], 6) / 2, y: M - 12, size: 6, font, color: GREY });
    p.drawText(t[2], { x: A4[0] - M - font.widthOfTextAtSize(t[2], 6), y: M - 12, size: 6, font, color: GREY });
  });

  return await doc.save();
}
