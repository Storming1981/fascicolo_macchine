import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { fmtDate, fmtDateLong, fmtDateTime, fmtHM } from "./format";
import { A4, GREY, INK, LINE, MARGIN as M, NAVY, TRAVEL, ZEBRA, isTravel, loadLetterhead, san } from "./pdfCommon";

/**
 * Riepilogo di TUTTE le giornate di un intervento in un unico PDF, con una sola
 * firma in fondo: per un'installazione lunga il cliente firma una volta a fine
 * lavori, invece di un foglio al giorno. I rapportini giornalieri restano come
 * sono (uno per giornata, con la loro firma).
 */

export type RiepilogoDay = {
  date: Date;
  closed: boolean;
  operators: { name: string; sessions: { start: string; end: string; hours: number; type?: string | null }[]; total: number }[];
  totalHours: number;
  workDescription: string | null;
  issues: string | null;
};

export type RiepilogoPdfInput = {
  interventoCode: string;
  interventoTitle: string;
  customer: string | null;
  site: string | null;
  addressStreet?: string | null;
  city?: string | null;
  country?: string | null;
  machineJob?: string | null;
  commessa?: string | null;
  days: RiepilogoDay[];
  totals: { hours: number; travelHours: number; byOperator: { name: string; hours: number }[] };
  techName: string | null;
  techSigDataUrl?: string | null;
  clientName: string | null;
  clientSigDataUrl?: string | null;
  signedAt: Date | null;
  generatedAt: Date;
  hash: string;
};

const W = A4[0];
const fmtDay = (d: Date) =>
  fmtDateLong(d);
const fmtShort = (d: Date) => fmtDate(d);

export async function generateRiepilogoPdf(input: RiepilogoPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Riepilogo ${input.interventoCode}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const lh = await loadLetterhead();
  let hImg: PDFImage | undefined;
  let fImg: PDFImage | undefined;
  try {
    if (lh.header) hImg = await doc.embedJpg(lh.header);
  } catch {}
  try {
    if (lh.footer) fImg = await doc.embedJpg(lh.footer);
  } catch {}
  const headerH = hImg ? (hImg.height / hImg.width) * W : 0;
  const footerH = fImg ? (fImg.height / fImg.width) * W : 0;
  const topStart = A4[1] - (headerH ? headerH + 14 : M);
  const bottomLimit = footerH ? footerH + 14 : M;

  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([A4[0], A4[1]]);
    if (hImg) page.drawImage(hImg, { x: 0, y: A4[1] - headerH, width: W, height: headerH });
    if (fImg) page.drawImage(fImg, { x: 0, y: 0, width: W, height: footerH });
    y = topStart;
  };
  const ensure = (h: number) => {
    if (y - h < bottomLimit) newPage();
  };
  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = san(text).split(/\s+/).filter(Boolean);
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
  };
  const text = (
    s: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: typeof INK; maxW?: number; gap?: number } = {}
  ) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const x = opts.x ?? M;
    for (const ln of wrap(s, f, size, opts.maxW ?? W - M - x)) {
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

  newPage();

  // ── Intestazione ──
  text("RIEPILOGO INTERVENTO", { size: 16, font: bold, color: NAVY, gap: 4 });
  text(`Intervento ${input.interventoCode} — ${input.interventoTitle}`, { size: 10, color: GREY });
  if (input.customer)
    text(`Cliente: ${input.customer}${input.site ? " · " + input.site : ""}`, { size: 10, color: GREY });
  y -= 2;
  labelRow("Indirizzo:", input.addressStreet);
  labelRow("Città:", input.city, "Nazione:", input.country);
  labelRow("Macchina:", input.machineJob, "Commessa:", input.commessa);

  const first = input.days[0]?.date;
  const last = input.days[input.days.length - 1]?.date;
  labelRow(
    "Periodo:",
    first && last ? `dal ${fmtShort(first)} al ${fmtShort(last)}` : null,
    "Giornate:",
    String(input.days.length)
  );
  labelRow(
    "Ore totali:",
    fmtHM(input.totals.hours),
    input.totals.travelHours > 0 ? "di cui viaggio:" : undefined,
    input.totals.travelHours > 0 ? fmtHM(input.totals.travelHours) : undefined
  );
  hr();

  // ── Una sezione per giornata ──
  const rowH = 15;
  const xIn = M + 160;
  const xOut = M + 235;
  const xType = M + 310;
  const xHours = W - M - 60;

  for (const day of input.days) {
    // la testata della giornata non resta orfana in fondo alla pagina
    ensure(rowH * 3 + 26);
    y -= 6;
    page.drawText(san(fmtDay(day.date)), { x: M, y: y - 11, size: 11, font: bold, color: NAVY });
    page.drawText(day.closed ? "CHIUSO" : "BOZZA", {
      x: W - M - 46,
      y: y - 11,
      size: 8,
      font: bold,
      color: day.closed ? rgb(0.06, 0.5, 0.32) : rgb(0.6, 0.4, 0.02),
    });
    y -= 18;

    // testata tabella ore
    ensure(rowH);
    page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: NAVY });
    const wh = (t: string, x: number) =>
      page.drawText(t, { x: x + 6, y: y - 10, size: 8.5, font: bold, color: rgb(1, 1, 1) });
    wh("Operatore", M);
    wh("Entrata", xIn);
    wh("Uscita", xOut);
    wh("Tipologia", xType);
    wh("Ore", xHours);
    y -= rowH;

    let zebra = 0;
    for (const op of day.operators) {
      const sessions = op.sessions.length ? op.sessions : [{ start: "", end: "", hours: op.total, type: null }];
      sessions.forEach((s, i) => {
        ensure(rowH);
        if (zebra % 2 === 1)
          page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: ZEBRA });
        zebra++;
        if (i === 0) {
          const nm = wrap(op.name || "—", font, 9, xIn - M - 12)[0] ?? "—";
          page.drawText(nm, { x: M + 6, y: y - 10, size: 9, font: bold, color: INK });
        }
        page.drawText(s.start || "—", { x: xIn + 6, y: y - 10, size: 9, font, color: INK });
        page.drawText(s.end || "—", { x: xOut + 6, y: y - 10, size: 9, font, color: INK });
        if (s.type)
          page.drawText(san(s.type), {
            x: xType + 6,
            y: y - 10,
            size: 9,
            font: isTravel(s.type) ? bold : font,
            color: isTravel(s.type) ? TRAVEL : GREY,
          });
        page.drawText(fmtHM(s.hours), { x: xHours + 6, y: y - 10, size: 9, font, color: INK });
        y -= rowH;
      });
    }
    ensure(rowH);
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.6, color: LINE });
    page.drawText("Totale giornata", { x: M + 6, y: y - 10, size: 9, font: bold, color: NAVY });
    page.drawText(fmtHM(day.totalHours), { x: xHours + 6, y: y - 10, size: 9, font: bold, color: NAVY });
    y -= rowH + 4;

    if (day.workDescription?.trim()) {
      text("ATTIVITÀ ESEGUITA", { size: 8.5, font: bold, color: NAVY, gap: 2 });
      text(day.workDescription.trim(), { size: 9.5, gap: 2 });
      y -= 2;
    }
    if (day.issues?.trim()) {
      text("PROBLEMATICHE RILEVATE", { size: 8.5, font: bold, color: NAVY, gap: 2 });
      text(day.issues.trim(), { size: 9.5, gap: 2 });
      y -= 2;
    }
    hr();
  }

  // ── Totale per operatore su tutto l'intervento ──
  if (input.totals.byOperator.length) {
    ensure(20 + rowH * (input.totals.byOperator.length + 1));
    y -= 4;
    text("TOTALE ORE PER OPERATORE", { size: 11, font: bold, color: NAVY, gap: 4 });
    for (const op of input.totals.byOperator) {
      ensure(rowH);
      page.drawText(san(op.name), { x: M + 6, y: y - 10, size: 9.5, font, color: INK });
      page.drawText(fmtHM(op.hours), { x: xHours + 6, y: y - 10, size: 9.5, font, color: INK });
      y -= rowH;
    }
    ensure(rowH);
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.6, color: LINE });
    page.drawText("Totale intervento", { x: M + 6, y: y - 10, size: 10, font: bold, color: NAVY });
    page.drawText(fmtHM(input.totals.hours), { x: xHours + 6, y: y - 10, size: 10, font: bold, color: NAVY });
    y -= rowH;
    if (input.totals.travelHours > 0) {
      ensure(rowH);
      page.drawText("di cui viaggio", { x: M + 6, y: y - 9, size: 8.5, font, color: TRAVEL });
      page.drawText(fmtHM(input.totals.travelHours), { x: xHours + 6, y: y - 9, size: 8.5, font: bold, color: TRAVEL });
      y -= rowH - 2;
    }
  }

  // ── Firma unica di fine intervento ──
  y -= 6;
  hr();
  // il blocco firma sta in fondo all ultima pagina se ci sta: qui serve poco spazio
  // Se il blocco firma non ci sta (il piede della carta intestata e alto), va
  // su una pagina nuova: allora si ripete il riferimento, per non lasciare un
  // foglio con due righe e nessun contesto.
  const pagesBefore = doc.getPageCount();
  ensure(72);
  if (doc.getPageCount() > pagesBefore) {
    page.drawText(san(`${input.interventoCode} - ${input.interventoTitle}`), {
      x: M,
      y: y - 10,
      size: 9.5,
      font: bold,
      color: NAVY,
    });
    y -= 22;
  }
  const colW = (W - 2 * M - 24) / 2;
  const sigTop = y;
  async function drawSig(x: number, title: string, name: string | null, dataUrl?: string | null) {
    page.drawText(san(title), { x, y: sigTop - 10, size: 9, font: bold, color: NAVY });
    if (dataUrl?.startsWith("data:image")) {
      try {
        const bytes = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
        const img = dataUrl.includes("image/jpeg") ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        const h = 30;
        const w = Math.min(colW - 10, (img.width / img.height) * h);
        page.drawImage(img, { x, y: sigTop - 48, width: w, height: h });
      } catch {
        /* firma non incorporabile */
      }
    }
    page.drawLine({
      start: { x, y: sigTop - 50 },
      end: { x: x + colW, y: sigTop - 50 },
      thickness: 0.6,
      color: rgb(0.8, 0.82, 0.85),
    });
    page.drawText(san(name || ""), { x, y: sigTop - 61, size: 9, font, color: INK });
  }
  await drawSig(M, "Firma tecnico", input.techName, input.techSigDataUrl);
  await drawSig(M + colW + 24, "Firma cliente", input.clientName, input.clientSigDataUrl);
  y = sigTop - 74;
  page.drawText(
    san(
      input.signedAt
        ? `Firma unica di fine intervento, apposta il ${fmtDateTime(input.signedAt)} — vale per tutte le ${input.days.length} giornate del riepilogo.`
        : `Riepilogo non ancora firmato — ${input.days.length} giornate.`
    ),
    { x: M, y, size: 8, font, color: GREY }
  );
  y -= 12;

  text(
    `Documento generato il ${fmtDateTime(input.generatedAt)} · SHA256 ${input.hash.slice(0, 32)}`,
    { size: 7.5, color: GREY, gap: 2 }
  );

  // numerazione pagine (nota: il piede della carta intestata resta sotto)
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const t = san(`${input.interventoCode} · riepilogo · pagina ${i + 1} di ${pages.length}`);
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 7), y: bottomLimit - 10, size: 7, font, color: GREY });
  });

  return await doc.save();
}
