import { INDEX, estimateTokens } from "./config";
import type { ExtractedPage } from "./extract";

export type Chunk = {
  seq: number;
  breadcrumb: string;
  heading: string | null;
  page: number | null;
  text: string;
  tokens: number;
  videoAt: number | null;
};

/** Riconosce un titolo di sezione: markdown, numerazione "4.2.1", o riga in MAIUSCOLO. */
export function headingOf(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 110) return null;

  const md = t.match(/^#{1,6}\s+(.*)$/);
  if (md) return md[1].trim();

  // Numerazione gerarchica ("6.2.1 Accensione", "5.7 PRIMO AVVIAMENTO"):
  // e' sempre un titolo di capitolo.
  if (/^\d+\.\d+(\.\d+){0,2}[.)]?\s+\S/.test(t) && t.length < 90) return t;

  // Numero singolo: quasi sempre e' una VOCE DI ELENCO, non un titolo.
  // "1. Aprire l'accesso principale" e' un passo della procedura: trattarlo da
  // titolo spezzava la procedura in un frammento per passo e, peggio, staccava
  // i passi dal capitolo che li introduce ("6.2.1 Accensione") — che e' proprio
  // la parola con cui li si cerca. Fa eccezione il capitolo di primo livello
  // scritto in maiuscolo ("7 MANUTENZIONE").
  const singolo = t.match(/^\d+[.)]?\s+(\S.*)$/);
  if (singolo) {
    const resto = singolo[1];
    const lettere = resto.replace(/[^A-Za-zÀ-ÿ]/g, "");
    const maiuscolo = lettere.length >= 3 && lettere === lettere.toUpperCase();
    return maiuscolo && resto.length < 60 ? t : null;
  }

  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && !/[.;:]$/.test(t)) return t;
  return null;
}

/**
 * Spezza il testo in blocchi da ~450 token rispettando i confini naturali
 * (paragrafo → frase) e portandosi dietro il titolo di sezione corrente.
 *
 * Ogni chunk conserva un breadcrumb ("Manuale BLUE DEVIL › 4.2 Cambio lame › p. 42"):
 * finisce come titolo del documento nel prompt, quindi la citazione che il
 * modello restituisce è già leggibile da un tecnico senza aprire il PDF.
 */
export function chunkPages(pages: ExtractedPage[], docTitle: string): Chunk[] {
  const chunks: Chunk[] = [];
  const multiPage = pages.length > 1;
  let seq = 0;
  let heading: string | null = null;

  const push = (text: string, page: number | null, head: string | null) => {
    const body = text.trim();
    if (body.length < 40) return; // scarto: intestazioni, numeri di pagina isolati
    const parts = [docTitle];
    if (head) parts.push(head);
    if (page && multiPage) parts.push(`p. ${page}`);
    const breadcrumb = parts.join(" › ");
    chunks.push({
      seq: seq++,
      breadcrumb,
      heading: head,
      page,
      text: body,
      tokens: estimateTokens(body),
      videoAt: null,
    });
  };

  for (const p of pages) {
    if (!p.text.trim()) continue;
    const blocks = p.text.split(/\n{2,}/);
    let buf = "";
    let bufHeading = heading;

    const flush = () => {
      if (buf.trim()) push(buf, p.page, bufHeading);
      buf = "";
      bufHeading = heading;
    };

    for (const block of blocks) {
      const firstLine = block.split("\n")[0];
      const h = headingOf(firstLine);
      if (h) {
        // Nuova sezione: chiude il blocco corrente per non mescolare argomenti.
        flush();
        heading = h;
        bufHeading = h;
      }

      for (const piece of splitLong(block)) {
        if (buf.length + piece.length + 2 > INDEX.chunkChars && buf.length > 0) {
          push(buf, p.page, bufHeading);
          // Coda del blocco precedente come contesto: una procedura tagliata a
          // metà resta comprensibile anche nel chunk successivo.
          buf = tail(buf, INDEX.overlapChars);
          bufHeading = heading;
        }
        buf += (buf ? "\n\n" : "") + piece;
      }
    }
    flush();
  }

  return chunks;
}

/** Spezza un blocco più lungo del limite sui confini di frase. */
function splitLong(block: string): string[] {
  if (block.length <= INDEX.chunkChars) return [block];
  const sentences = block.split(/(?<=[.;:!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length + 1 > INDEX.chunkChars && cur) {
      out.push(cur);
      cur = "";
    }
    // Frase singola gigante (tabelle, elenchi senza punteggiatura): taglio netto.
    if (s.length > INDEX.chunkChars) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      for (let i = 0; i < s.length; i += INDEX.chunkChars) out.push(s.slice(i, i + INDEX.chunkChars));
      continue;
    }
    cur += (cur ? " " : "") + s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Ultimi ~n caratteri, tagliati su un confine di frase quando possibile. */
function tail(text: string, n: number): string {
  const t = text.slice(-n);
  const cut = t.search(/(?<=[.;:!?])\s+/);
  return (cut > 0 ? t.slice(cut) : t).trim();
}

/**
 * Trascrizione di un video: le righe con timestamp ("12:30 Smontare il carter")
 * diventano chunk agganciati al secondo esatto, così il Brain può proporre il
 * video già posizionato sul passaggio giusto.
 */
export function chunkTranscript(transcript: string, docTitle: string): Chunk[] {
  const lines = transcript.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const stamped: { at: number; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]?\s*[-–]?\s*(.*)$/);
    if (m && m[4]) {
      const at = (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
      stamped.push({ at, text: m[4] });
    } else if (stamped.length) {
      stamped[stamped.length - 1].text += " " + line;
    } else {
      stamped.push({ at: 0, text: line });
    }
  }

  const chunks: Chunk[] = [];
  let buf = "";
  let at = 0;
  let seq = 0;
  const push = () => {
    const body = buf.trim();
    if (body.length < 40) return;
    chunks.push({
      seq: seq++,
      breadcrumb: `${docTitle} › video ${fmt(at)}`,
      heading: null,
      page: null,
      text: body,
      tokens: estimateTokens(body),
      videoAt: at,
    });
  };
  for (const s of stamped) {
    if (!buf) at = s.at;
    if (buf.length + s.text.length > INDEX.chunkChars) {
      push();
      buf = "";
      at = s.at;
    }
    buf += (buf ? " " : "") + s.text;
  }
  push();
  return chunks;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
