import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";

/** Carica (best-effort) le immagini della carta intestata ZATO. */
async function loadLetterhead(): Promise<{ header?: Buffer; footer?: Buffer }> {
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

const NAVY = rgb(0.06, 0.2, 0.36);
const GREY = rgb(0.42, 0.45, 0.5);
const INK = rgb(0.1, 0.12, 0.15);
const LINE = rgb(0.85, 0.87, 0.9);
const ZEBRA = rgb(0.96, 0.97, 0.98);

/** Normalizza il testo per la codifica WinAnsi di pdf-lib. */
function san(s: string): string {
  return (s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^ -ÿ]/g, "?");
}

const fmtHours = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export type RapportinoPdfInput = {
  interventoCode: string;
  interventoTitle: string;
  customer: string | null;
  site: string | null;
  addressStreet?: string | null; // via/indirizzo del cantiere
  city?: string | null; // città
  country?: string | null; // nazione (anagra: descrizione zona)
  machineJob?: string | null; // numero macchina del fascicolo (es. 1260100)
  commessa?: string | null; // commessa cantiere · timbratore
  plantHours?: number | null; // ore operative impianto (contaore macchina)
  date: Date;
  operators: { name: string; sessions: { start: string; end: string; hours: number }[]; total: number }[];
  totalHours: number;
  workDescription: string | null;
  issues?: string | null; // problematiche rilevate in cantiere
  ricambi: { code: string; desc: string; qty: string; note: string }[];
  photos?: string[]; // dataURL già letti (max ~6 miniature)
  techName: string | null;
  techSigDataUrl?: string | null;
  clientName: string | null;
  clientSigDataUrl?: string | null;
  compiledAt: Date;
  hash: string;
  closed: boolean;
};

const A4 = [595.28, 841.89] as const;
const M = 48; // margine

export async function generateRapportinoPdf(input: RapportinoPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = A4[0];

  // Carta intestata (header + footer) su ogni pagina
  const lh = await loadLetterhead();
  let hImg: PDFImage | undefined;
  let fImg: PDFImage | undefined;
  try {
    if (lh.header) hImg = await doc.embedJpg(lh.header);
  } catch {}
  try {
    if (lh.footer) fImg = await doc.embedJpg(lh.footer);
  } catch {}
  const fullW = W;
  const headerH = hImg ? (hImg.height / hImg.width) * fullW : 0;
  const footerH = fImg ? (fImg.height / fImg.width) * fullW : 0;
  const topStart = A4[1] - (headerH ? headerH + 14 : M);
  const bottomLimit = footerH ? footerH + 14 : M;

  const decorate = (p: ReturnType<typeof doc.addPage>) => {
    if (hImg) p.drawImage(hImg, { x: 0, y: A4[1] - headerH, width: fullW, height: headerH });
    if (fImg) p.drawImage(fImg, { x: 0, y: 0, width: fullW, height: footerH });
  };
  const newPage = () => {
    const p = doc.addPage([A4[0], A4[1]]);
    decorate(p);
    return p;
  };

  let page = newPage();
  let y = topStart;

  const ensure = (h: number) => {
    if (y - h < bottomLimit) {
      page = newPage();
      y = topStart;
    }
  };
  const wrap = (text: string, f: typeof font, size: number, maxW: number): string[] => {
    const words = san(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(t, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = (
    s: string,
    opts: { x?: number; size?: number; font?: typeof font; color?: typeof NAVY; maxW?: number; gap?: number } = {}
  ) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const x = opts.x ?? M;
    const maxW = opts.maxW ?? W - M - x;
    const lines = wrap(s, f, size, maxW);
    for (const ln of lines) {
      ensure(size + 4);
      page.drawText(ln, { x, y: y - size, size, font: f, color: opts.color ?? INK });
      y -= size + (opts.gap ?? 3);
    }
  };
  const hr = () => {
    ensure(10);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    y -= 10;
  };
  const sectionTitle = (s: string) => {
    y -= 8;
    ensure(18);
    text(s.toUpperCase(), { size: 11, font: bold, color: NAVY, gap: 4 });
  };

  // ── Intestazione ──
  text("RAPPORTINO DI INTERVENTO", { size: 16, font: bold, color: NAVY, gap: 4 });
  text(`Intervento ${input.interventoCode} — ${input.interventoTitle}`, { size: 10, color: GREY });
  if (input.customer)
    text(`Cliente: ${input.customer}${input.site ? " · " + input.site : ""}`, { size: 10, color: GREY });
  y -= 2;

  /** Riga con etichette in grassetto (fino a 2 colonne). */
  const labelRow = (l1: string, v1?: string | null, l2?: string, v2?: string | null) => {
    if (!v1 && !v2) return;
    ensure(16);
    if (v1) {
      page.drawText(san(l1), { x: M, y: y - 10, size: 9.5, font: bold, color: NAVY });
      page.drawText(san(v1), { x: M + 90, y: y - 10, size: 9.5, font, color: INK });
    }
    if (l2 && v2) {
      page.drawText(san(l2), { x: M + 250, y: y - 10, size: 9.5, font: bold, color: NAVY });
      page.drawText(san(v2), { x: M + 330, y: y - 10, size: 9.5, font, color: INK });
    }
    y -= 16;
  };

  // Indirizzo cantiere · Città / Nazione · Macchina / Commessa
  labelRow("Indirizzo:", input.addressStreet);
  labelRow("Città:", input.city, "Nazione:", input.country);
  labelRow("Macchina:", input.machineJob, "Commessa:", input.commessa);

  // Data giornata + stato
  ensure(16);
  page.drawText(san("Data giornata:"), { x: M, y: y - 10, size: 9.5, font: bold, color: NAVY });
  page.drawText(
    san(input.date.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })),
    { x: M + 90, y: y - 10, size: 9.5, font, color: INK }
  );
  page.drawText(input.closed ? san("CHIUSO") : san("BOZZA"), {
    x: W - M - 60,
    y: y - 10,
    size: 9,
    font: bold,
    color: input.closed ? rgb(0.06, 0.5, 0.32) : rgb(0.6, 0.4, 0.02),
  });
  y -= 18;
  // Ore operative dell'impianto (contaore macchina) rilevate nell'intervento
  if (input.plantHours != null) labelRow("Ore impianto:", `${fmtHours(input.plantHours)} h`);
  hr();

  // ── Timbrature per operatore (entrata/uscita) ──
  sectionTitle("Ore per operatore");
  {
    const x0 = M;
    const xIn = x0 + 200; // Entrata
    const xOut = x0 + 300; // Uscita
    const xHours = W - M - 60; // Ore
    const rowH = 15;
    // testata
    ensure(rowH);
    page.drawRectangle({ x: x0, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: NAVY });
    const wh = (t: string, x: number) => page.drawText(t, { x: x + 6, y: y - 10, size: 8.5, font: bold, color: rgb(1, 1, 1) });
    wh("Operatore", x0);
    wh("Entrata", xIn);
    wh("Uscita", xOut);
    wh("Ore", xHours);
    y -= rowH;

    let zebra = 0;
    for (const op of input.operators) {
      const sessions = op.sessions.length ? op.sessions : [{ start: "", end: "", hours: op.total }];
      sessions.forEach((s, i) => {
        ensure(rowH);
        if (zebra % 2 === 1)
          page.drawRectangle({ x: x0, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: ZEBRA });
        zebra++;
        // nome solo sulla prima riga dell'operatore
        if (i === 0) {
          const nm = wrap(op.name || "—", font, 9, xIn - x0 - 12)[0] ?? "—";
          page.drawText(nm, { x: x0 + 6, y: y - 10, size: 9, font: bold, color: INK });
        }
        page.drawText(s.start || "—", { x: xIn + 6, y: y - 10, size: 9, font, color: INK });
        page.drawText(s.end || "—", { x: xOut + 6, y: y - 10, size: 9, font, color: INK });
        page.drawText(fmtHours(s.hours), { x: xHours + 6, y: y - 10, size: 9, font, color: INK });
        y -= rowH;
      });
      // subtotale operatore se ha più sessioni
      if (op.sessions.length > 1) {
        ensure(rowH);
        page.drawText("subtotale", { x: xOut + 6, y: y - 9, size: 7.5, font, color: GREY });
        page.drawText(`${fmtHours(op.total)} h`, { x: xHours + 6, y: y - 9, size: 8, font: bold, color: GREY });
        y -= rowH - 2;
      }
    }
    // totale giornata
    ensure(rowH);
    page.drawLine({ start: { x: x0, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.6, color: LINE });
    page.drawText("Totale giornata", { x: x0 + 6, y: y - 10, size: 9.5, font: bold, color: NAVY });
    page.drawText(`${fmtHours(input.totalHours)} h`, { x: xHours + 6, y: y - 10, size: 9.5, font: bold, color: NAVY });
    y -= rowH + 2;
  }

  // ── Attività eseguita ──
  sectionTitle("Attività eseguita");
  text(input.workDescription?.trim() || "—", { size: 10, gap: 3 });

  // Problematiche / mancanze rilevate in cantiere
  if (input.issues?.trim()) {
    sectionTitle("Problematiche rilevate");
    text(input.issues.trim(), { size: 10, gap: 3 });
  }

  // ── Ricambi utilizzati ──
  const ricambi = input.ricambi.filter((r) => (r.code || "").trim() || (r.desc || "").trim());
  if (ricambi.length) {
    sectionTitle("Ricambi utilizzati");
    const x0 = M;
    const cCode = x0;
    const cDesc = x0 + 90;
    const cQty = W - M - 130;
    const cNote = W - M - 100;
    const rowH = 15;
    ensure(rowH);
    page.drawRectangle({ x: x0, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: NAVY });
    const wh = (t: string, x: number) => page.drawText(t, { x: x + 4, y: y - 10, size: 8.5, font: bold, color: rgb(1, 1, 1) });
    wh("Codice", cCode);
    wh("Descrizione", cDesc);
    wh("Q.tà", cQty);
    wh("Note", cNote);
    y -= rowH;
    ricambi.forEach((r, i) => {
      const descLines = wrap(r.desc || "—", font, 8.5, cQty - cDesc - 8);
      const noteLines = wrap(r.note || "", font, 8.5, W - M - cNote - 6);
      const h = Math.max(rowH, descLines.length * 11 + 4, noteLines.length * 11 + 4);
      ensure(h);
      if (i % 2 === 1) page.drawRectangle({ x: x0, y: y - h + 3, width: W - 2 * M, height: h, color: ZEBRA });
      page.drawText(san(r.code || "—"), { x: cCode + 4, y: y - 10, size: 8.5, font, color: INK });
      descLines.forEach((ln, k) => page.drawText(ln, { x: cDesc + 4, y: y - 10 - k * 11, size: 8.5, font, color: INK }));
      page.drawText(san(r.qty || ""), { x: cQty + 4, y: y - 10, size: 8.5, font, color: INK });
      noteLines.forEach((ln, k) => page.drawText(ln, { x: cNote + 4, y: y - 10 - k * 11, size: 8.5, font, color: INK }));
      y -= h;
    });
    y -= 2;
  }

  // ── Foto (miniature) ──
  const photos = (input.photos ?? []).filter((p) => p.startsWith("data:image")).slice(0, 6);
  if (photos.length) {
    sectionTitle("Foto cantiere");
    const gap = 8;
    const perRow = 3;
    const thumbW = (W - 2 * M - gap * (perRow - 1)) / perRow;
    const thumbH = thumbW * 0.7;
    let col = 0;
    let rowTop = y;
    for (const p of photos) {
      if (col === 0) {
        ensure(thumbH + gap);
        rowTop = y;
      }
      const x = M + col * (thumbW + gap);
      try {
        const b64 = p.split(",")[1] ?? "";
        const bytes = Buffer.from(b64, "base64");
        const img = p.includes("image/jpeg") ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        const ratio = Math.min(thumbW / img.width, thumbH / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        page.drawImage(img, { x, y: rowTop - h, width: w, height: h });
      } catch {
        /* immagine non incorporabile */
      }
      col++;
      if (col === perRow) {
        col = 0;
        y = rowTop - thumbH - gap;
      }
    }
    if (col !== 0) y = rowTop - thumbH - gap;
  }

  // ── Firme ──
  y -= 8;
  hr();
  ensure(96);
  const colW = (W - 2 * M - 24) / 2;
  const sigTop = y;
  async function drawSig(x: number, title: string, name: string | null, dataUrl?: string | null) {
    page.drawText(san(title), { x, y: sigTop - 10, size: 9, font: bold, color: NAVY });
    if (dataUrl && dataUrl.startsWith("data:image")) {
      try {
        const b64 = dataUrl.split(",")[1] ?? "";
        const bytes = Buffer.from(b64, "base64");
        const img = dataUrl.includes("image/jpeg") ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        const h = 42;
        const w = Math.min(colW - 10, (img.width / img.height) * h);
        page.drawImage(img, { x, y: sigTop - 58, width: w, height: h });
      } catch {
        /* firma non incorporabile */
      }
    }
    page.drawLine({ start: { x, y: sigTop - 62 }, end: { x: x + colW, y: sigTop - 62 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.85) });
    page.drawText(san(name || ""), { x, y: sigTop - 74, size: 9, font, color: INK });
  }
  await drawSig(M, "Firma tecnico", input.techName, input.techSigDataUrl);
  await drawSig(M + colW + 24, "Firma cliente", input.clientName, input.clientSigDataUrl);
  y = sigTop - 92;

  // Riga di validazione
  y -= 4;
  text(
    `Documento generato il ${input.compiledAt.toLocaleString("it-IT")} · SHA256 ${input.hash.slice(0, 32)}`,
    { size: 7.5, font, color: GREY, gap: 2 }
  );

  return await doc.save();
}
