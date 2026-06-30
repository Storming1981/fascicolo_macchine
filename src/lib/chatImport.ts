/**
 * Parser per l'import dello storico chat WhatsApp/Telegram nel portale ZATO.
 * Nessuna connessione live: si importano i file di export ("Esporta chat").
 *  - WhatsApp: export .txt ("senza media")
 *  - Telegram: export .json (Telegram Desktop → Export chat history → JSON)
 */

export type ParsedMessage = {
  authorName: string;
  body: string | null;
  sentAt: Date | null;
  hasMedia: boolean;
};

export type ParsedChat = {
  provider: "whatsapp" | "telegram";
  title: string | null;
  participants: string[];
  messages: ParsedMessage[];
};

const MEDIA_HINTS = [
  "<media omessi>",
  "<media omitted>",
  "immagine omessa",
  "image omitted",
  "file allegato",
  "(file attached)",
  "‎<allegato:",
];

function looksLikeMedia(text: string): boolean {
  const t = text.toLowerCase();
  return MEDIA_HINTS.some((h) => t.includes(h));
}

// Riga WhatsApp:  [12/05/24, 14:02:33] Nome: testo   oppure
//                 12/05/2024, 14:02 - Nome: testo
const WA_LINE =
  /^‎?\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?: ?[APap]\.?[Mm]\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s?([\s\S]*)$/;
// Riga di sistema (senza autore): timestamp - testo
const WA_SYS =
  /^‎?\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?: ?[APap]\.?[Mm]\.?)?\]?\s*[-–]\s*([\s\S]*)$/;

function buildDate(d: string, m: string, y: string, hh: string, mm: string, ss?: string): Date | null {
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  const date = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), ss ? parseInt(ss, 10) : 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseWhatsApp(text: string): ParsedChat {
  const lines = text.split(/\r?\n/);
  const messages: ParsedMessage[] = [];
  const participants = new Set<string>();

  for (const raw of lines) {
    if (!raw.trim() && messages.length === 0) continue;
    const m = WA_LINE.exec(raw);
    if (m) {
      const [, d, mo, y, hh, mm, ss, author, body] = m;
      const name = author.trim();
      // Le righe di sistema possono apparire come "autore" se contengono ":";
      // teniamo solo nomi plausibili (no URL).
      participants.add(name);
      messages.push({
        authorName: name,
        body: looksLikeMedia(body) ? null : body.trim() || null,
        sentAt: buildDate(d, mo, y, hh, mm, ss),
        hasMedia: looksLikeMedia(body),
      });
      continue;
    }
    if (WA_SYS.test(raw)) continue; // messaggio di sistema: ignora
    // riga di continuazione del messaggio precedente (multi-line)
    if (messages.length > 0 && raw.length > 0) {
      const last = messages[messages.length - 1];
      last.body = `${last.body ? last.body + "\n" : ""}${raw}`.trim() || null;
    }
  }

  return {
    provider: "whatsapp",
    title: null,
    participants: [...participants],
    messages,
  };
}

type TgText = string | { type?: string; text?: string } | Array<string | { type?: string; text?: string }>;

function tgTextToString(t: TgText | undefined): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  return t.text ?? "";
}

export function parseTelegram(jsonRaw: string): ParsedChat {
  let data: { name?: string; messages?: unknown[] };
  try {
    data = JSON.parse(jsonRaw);
  } catch {
    return { provider: "telegram", title: null, participants: [], messages: [] };
  }
  const messages: ParsedMessage[] = [];
  const participants = new Set<string>();

  for (const raw of data.messages ?? []) {
    const mm = raw as {
      type?: string;
      from?: string;
      actor?: string;
      date?: string;
      text?: TgText;
      photo?: string;
      media_type?: string;
      file?: string;
    };
    if (mm.type && mm.type !== "message") continue;
    const author = (mm.from ?? mm.actor ?? "Sconosciuto").toString().trim();
    participants.add(author);
    const body = tgTextToString(mm.text).trim();
    const hasMedia = Boolean(mm.photo || mm.media_type || mm.file);
    messages.push({
      authorName: author,
      body: body || null,
      sentAt: mm.date ? new Date(mm.date) : null,
      hasMedia,
    });
  }

  return {
    provider: "telegram",
    title: typeof data.name === "string" ? data.name : null,
    participants: [...participants],
    messages,
  };
}

export function parseChatExport(provider: "whatsapp" | "telegram", content: string): ParsedChat {
  return provider === "telegram" ? parseTelegram(content) : parseWhatsApp(content);
}
