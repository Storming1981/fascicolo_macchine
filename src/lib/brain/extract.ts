import { promises as fs } from "fs";
import path from "path";
import { INDEX, UTILITY_MODEL } from "./config";
import { anthropic } from "./client";
import { uploadLocalPath } from "@/lib/uploadPath";
import type Anthropic from "@anthropic-ai/sdk";

export type ExtractedPage = { page: number; text: string };
export type Extraction = {
  pages: ExtractedPage[];
  pageCount: number;
  /** true se il testo è stato ricavato dall'AI (PDF scansionato o immagine). */
  ocrUsed: boolean;
  /** Nota diagnostica da mostrare all'operatore (es. "12 pagine scansionate"). */
  note?: string;
};

/** Normalizza il testo estratto: sillabazione a fine riga, spazi, righe vuote. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/([a-zàèéìòù])-\n([a-zàèéìòù])/g, "$1$2") // "manuten-" + "zione" → "manutenzione"
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ─────────────────────────── PDF ─────────────────────────── */

/**
 * Estrae il testo pagina per pagina con pdfjs. Ricostruisce le righe dalle
 * coordinate Y degli item: senza questo un manuale a due colonne esce a insalata
 * e il retrieval peggiora sensibilmente.
 */
async function extractPdf(file: string): Promise<Extraction> {
  // Build legacy: è quella pensata per Node (niente DOM, niente worker).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pageCount = doc.numPages;

  const pages: ExtractedPage[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[] };
      if (!it.str || !it.transform) continue;
      const y = Math.round(it.transform[5] / 3) * 3; // tolleranza: stessa riga
      const arr = lines.get(y) ?? [];
      arr.push({ x: it.transform[4], s: it.str });
      lines.set(y, arr);
    }
    const text = [...lines.entries()]
      .sort((a, b) => b[0] - a[0]) // dall'alto verso il basso
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.s)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean)
      .join("\n");
    pages.push({ page: n, text: cleanText(text) });
    page.cleanup();
  }
  await doc.destroy();

  const rimosse = stripRunningHeaders(pages);
  return {
    pages,
    pageCount,
    ocrUsed: false,
    note: rimosse ? `${rimosse} righe di testata/piè di pagina rimosse` : undefined,
  };
}

/**
 * Toglie testate e piè di pagina che si ripetono su tutte le pagine.
 *
 * Senza questo passaggio ogni pagina produce un frammento fantasma tipo
 * "BLUE DEVIL GF 4000 II 16 / 105 — Versione 01": 70 caratteri che contengono
 * il nome della macchina. Sono corti (quindi ts_rank li premia) e nominano
 * l'impianto (quindi agganciano ogni domanda che lo nomina), così un manuale da
 * 105 pagine risponde con 105 piè di pagina e il contenuto vero non emerge mai.
 *
 * Si guardano solo le righe di bordo, si normalizzano i numeri (il numero di
 * pagina cambia a ogni pagina) e si scarta ciò che ricorre su almeno il 40%
 * delle pagine.
 */
export function stripRunningHeaders(pages: ExtractedPage[]): number {
  if (pages.length < 5) return 0;

  // Cinque righe e non tre: il piè di pagina si spezza spesso su piu' righe
  // ("BLUE DEVIL" / "GF 4000 II" / "96 / 105" / "Versione 01 - Revisione 1.0"),
  // e con una finestra corta la prima riga restava dentro. Ma la finestra non
  // deve mai coprire l'intera pagina: su una pagina di sette righe verrebbe
  // considerato "bordo" anche il corpo, e con una soglia bassa si cancellerebbe
  // il contenuto. Un'intestazione e' sempre una frazione piccola della pagina.
  const bordoDi = (n: number) => Math.min(5, Math.floor(n / 3));

  const norm = (l: string) =>
    l.trim().replace(/\d+/g, "#").replace(/\s+/g, " ").toLowerCase();

  // Un titolo numerato ("6.2.1 Accensione") non e' mai un'intestazione di
  // pagina: va protetto, perche' e' proprio quello che rende parlante il
  // breadcrumb del frammento nelle citazioni.
  // Dopo il numero ci vuole una LETTERA: senza, "67 / 105" (il numero di pagina)
  // passava per titolo di sezione e restava dentro.
  const titolo = (l: string) => /^\s*\d+(\.\d+)*[.)]?\s+[A-Za-zÀ-ÿ]/.test(l);

  const bordi = (lines: string[]) => {
    const e = bordoDi(lines.length);
    return e === 0 ? [] : [...lines.slice(0, e), ...lines.slice(-e)];
  };

  const counts = new Map<string, number>();
  for (const p of pages) {
    const lines = bordi(p.text.split("\n")).filter((l) => !titolo(l));
    for (const l of new Set(lines.map(norm))) {
      if (l.length < 4 || l.length > 120) continue;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }

  // Soglia bassa di proposito. Un manuale in parte nativo e in parte scansionato
  // ha DUE forme dello stesso piè di pagina (pdfjs unisce le righe, l'OCR le
  // separa): ognuna copre solo meta' documento, e col 40% non passava nessuna
  // delle due. Una riga di bordo che ricorre identica — numeri esclusi — su un
  // sesto delle pagine e' un'intestazione, non contenuto.
  const soglia = Math.max(3, Math.ceil(pages.length * 0.15));
  const ripetute = new Set(
    [...counts.entries()].filter(([, n]) => n >= soglia).map(([l]) => l)
  );
  if (ripetute.size === 0) return 0;

  let rimosse = 0;
  for (const p of pages) {
    const lines = p.text.split("\n");
    const e = bordoDi(lines.length);
    p.text = lines
      .filter((l, i) => {
        const bordo = e > 0 && (i < e || i >= lines.length - e);
        if (!bordo || titolo(l) || !ripetute.has(norm(l))) return true;
        rimosse++;
        return false;
      })
      .join("\n")
      .trim();
  }
  return rimosse;
}

/**
 * Pagine senza testo estraibile (scansioni) → le manda a Claude come documento
 * PDF nativo, a blocchi, e ne recupera il testo. Costa, quindi ha un tetto e
 * viene invocato solo sulle pagine che servono davvero.
 */
async function ocrPdfPages(
  file: string,
  pages: ExtractedPage[]
): Promise<{ filled: number; note?: string }> {
  const client = anthropic();
  const empty = pages.filter((p) => p.text.length < INDEX.minCharsPerPage);
  if (!client || empty.length === 0) return { filled: 0 };

  const target = empty.slice(0, INDEX.ocrMaxPages);
  const skipped = empty.length - target.length;

  // Si ritagliano le sole pagine da trascrivere in un PDF a sé stante. Mandare
  // il manuale intero a ogni chiamata sarebbe sbagliato due volte: oltre le 100
  // pagine l'API rifiuta il documento (ed è il caso della maggior parte dei
  // manuali ZATO), e si spedirebbero decine di MB per leggerne cinque pagine.
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(await fs.readFile(file));

  let filled = 0;
  const failures: string[] = [];

  for (let i = 0; i < target.length; i += INDEX.ocrPagesPerCall) {
    const batch = target.slice(i, i + INDEX.ocrPagesPerCall);
    try {
      const slice = await PDFDocument.create();
      const copied = await slice.copyPages(
        source,
        batch.map((p) => p.page - 1)
      );
      for (const page of copied) slice.addPage(page);
      const b64 = Buffer.from(await slice.save()).toString("base64");

      const res = await client.messages.create({
        model: UTILITY_MODEL,
        max_tokens: 16000,
        system:
          "Trascrivi fedelmente il testo tecnico di un manuale di impianti industriali ZATO. " +
          "Mantieni titoli, numerazione dei paragrafi, tabelle (in testo), codici articolo e " +
          "unità di misura. Non riassumere, non commentare. " +
          "Se una pagina è solo un disegno, descrivila brevemente fra parentesi quadre.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: b64 },
              },
              {
                type: "text",
                // Il documento allegato contiene SOLO le pagine da trascrivere,
                // rinumerate da 1: il modello non deve sapere nulla del manuale
                // originale, la corrispondenza la rifacciamo noi qui sotto.
                text:
                  `Trascrivi tutte le ${batch.length} pagine del documento allegato, nell'ordine. ` +
                  `Per ciascuna usa esattamente l'intestazione "=== PAGINA <n> ===" (n da 1 a ` +
                  `${batch.length}) seguita dal testo della pagina.`,
              },
            ],
          },
        ],
      });

      const out = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      batch.forEach((p, n) => {
        const re = new RegExp(`=== PAGINA ${n + 1} ===\\s*\\n([\\s\\S]*?)(?:=== PAGINA |$)`);
        const text = cleanText(out.match(re)?.[1] ?? "");
        if (text.length >= INDEX.minCharsPerPage) {
          p.text = text;
          filled++;
        }
      });
    } catch (e) {
      // Un blocco fallito non deve far cadere l'intero documento, ma il motivo
      // va riportato: ingoiarlo in silenzio lascia l'operatore davanti a un
      // "nessun testo estratto" senza sapere cosa sistemare.
      const msg = e instanceof Error ? e.message : String(e);
      if (failures.length < 3) failures.push(msg.slice(0, 160));
    }
  }

  const bits: string[] = [];
  if (filled) bits.push(`${filled} pagine trascritte con AI (documento scansionato)`);
  if (skipped) bits.push(`${skipped} pagine oltre il limite di ${INDEX.ocrMaxPages} non trascritte`);
  if (failures.length) bits.push(`trascrizione fallita su alcuni blocchi: ${failures.join(" · ")}`);
  return { filled, note: bits.join(" · ") || undefined };
}

/* ─────────────────────────── Word ─────────────────────────── */

/**
 * DOCX via mammoth. Passa dall'HTML (non da extractRawText) per conservare la
 * gerarchia dei titoli: i titoli diventano il breadcrumb dei chunk, che è quello
 * che rende leggibile la citazione nella risposta.
 */
async function extractDocx(file: string): Promise<Extraction> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ path: file });
  const text = html
    .replace(/<h([1-6])[^>]*>/gi, (_m, l: string) => "\n\n" + "#".repeat(Number(l)) + " ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return { pages: [{ page: 1, text: cleanText(text) }], pageCount: 1, ocrUsed: false };
}

/* ────────────────────── Immagini / disegni ────────────────────── */

type ImageMedia = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function imageMedia(mime: string): ImageMedia {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "image/jpeg";
  if (m === "image/gif") return "image/gif";
  if (m === "image/webp") return "image/webp";
  return "image/png";
}

/**
 * Un disegno tecnico o la foto di una targhetta non sono cercabili. Li si
 * descrive UNA VOLTA con Claude e si indicizza la descrizione: a runtime la
 * ricerca lavora su testo e l'immagine non viene mai rispedita al modello.
 */
export async function describeImage(
  file: string,
  mime: string,
  context: { title: string; plantType?: string | null; model?: string | null }
): Promise<string> {
  const client = anthropic();
  if (!client) throw new Error("ANTHROPIC_API_KEY non configurata");
  const res = await client.messages.create({
    model: UTILITY_MODEL,
    max_tokens: 2000,
    system:
      "Sei un tecnico ZATO (impianti di triturazione e selezione rottami ferrosi). " +
      "Descrivi l'immagine in modo da renderla RITROVABILE con una ricerca testuale: " +
      "tipo di documento (schema elettrico, idraulico, disegno meccanico, targhetta, foto guasto), " +
      "componenti e gruppi visibili, sigle e codici leggibili, numeri di posizione, " +
      "misure, collegamenti e flussi, eventuali anomalie. Elenca alla fine le parole chiave " +
      "con cui un tecnico cercherebbe questa immagine. Italiano, niente preamboli.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMedia(mime),
              data: (await fs.readFile(file)).toString("base64"),
            },
          },
          {
            type: "text",
            text: `Documento: "${context.title}". Impianto: ${context.plantType || "n/d"} ${context.model || ""}`.trim(),
          },
        ],
      },
    ],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/* ─────────────────────────── Dispatcher ─────────────────────────── */

export function isSupportedDocument(mime: string, name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return (
    mime === "application/pdf" ||
    ext === ".pdf" ||
    mime.includes("wordprocessingml") ||
    ext === ".docx" ||
    mime.startsWith("text/") ||
    [".txt", ".md", ".csv"].includes(ext) ||
    mime.startsWith("image/")
  );
}

/** Estrae il testo indicizzabile da un file caricato (path pubblico /uploads/...). */
export async function extractFile(
  publicPath: string,
  mime: string,
  context: { title: string; plantType?: string | null; model?: string | null; allowOcr?: boolean }
): Promise<Extraction> {
  const file = uploadLocalPath(publicPath);
  const ext = path.extname(file).toLowerCase();

  if (mime === "application/pdf" || ext === ".pdf") {
    const out = await extractPdf(file);
    const thin = out.pages.filter((p) => p.text.length < INDEX.minCharsPerPage).length;
    if (thin > 0 && context.allowOcr !== false) {
      const { filled, note } = await ocrPdfPages(file, out.pages);
      // Dopo l'OCR le testate ricompaiono (la trascrizione è fedele): si
      // ripulisce di nuovo, altrimenti tornano i frammenti-piè di pagina.
      const dopoOcr = filled > 0 ? stripRunningHeaders(out.pages) : 0;
      const note2 = [out.note, note, dopoOcr ? `${dopoOcr} righe ripetute rimosse dopo l'OCR` : ""]
        .filter(Boolean)
        .join(" · ");
      if (filled > 0) return { ...out, ocrUsed: true, note: note2 || undefined };
      if (note2) return { ...out, note: note2 };
    }
    return out;
  }

  if (mime.includes("wordprocessingml") || ext === ".docx") return extractDocx(file);

  if (mime.startsWith("image/")) {
    const text = await describeImage(file, mime, context);
    return { pages: [{ page: 1, text }], pageCount: 1, ocrUsed: true, note: "Immagine descritta dall'AI" };
  }

  if (ext === ".doc")
    throw new Error("Formato .doc non supportato: salva il file come .docx o PDF e ricaricalo");

  const text = cleanText(await fs.readFile(file, "utf8"));
  return { pages: [{ page: 1, text }], pageCount: 1, ocrUsed: false };
}
