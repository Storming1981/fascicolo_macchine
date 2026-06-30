import "server-only";

/**
 * Analisi AI di una conversazione service con Claude (Anthropic Messages API).
 * Usa structured output via tool_use. Degrada con grazia se la chiave non è
 * configurata. Modello configurabile via CHAT_AI_MODEL (default Haiku 4.5).
 */

const MODEL = process.env.CHAT_AI_MODEL || "claude-haiku-4-5-20251001";

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ChatAnalysis = {
  urgency: number; // 0..1
  category: string;
  sentiment: string;
  summary: string;
  suggestedReplies: string[];
  tags: string[];
};

type Msg = { authorName: string; direction: string; body: string | null };

export async function analyzeConversation(
  messages: Msg[],
  context: { customer?: string | null; machine?: string | null; intervento?: string | null }
): Promise<ChatAnalysis> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY non configurata");

  const transcript = messages
    .map((m) => `${m.direction === "OUT" ? "OPERATORE ZATO" : m.authorName}: ${m.body ?? "[media allegato]"}`)
    .join("\n");

  const tool = {
    name: "report",
    description: "Riporta l'analisi strutturata della conversazione service.",
    input_schema: {
      type: "object",
      properties: {
        urgency: { type: "number", description: "Urgenza 0..1 (1 = guasto bloccante / P1)" },
        category: { type: "string", description: "Categoria problema, es. 'Guasto meccanico', 'Allarme sensoristica', 'Richiesta pianificazione'" },
        sentiment: { type: "string", description: "Sentiment del cliente in una parola, es. 'Preoccupato', 'Neutro', 'Soddisfatto'" },
        summary: { type: "string", description: "Riassunto in 1-2 frasi in italiano" },
        suggestedReplies: { type: "array", items: { type: "string" }, description: "2-3 risposte professionali pronte da inviare, in italiano" },
        tags: { type: "array", items: { type: "string" }, description: "3-6 tag tecnici brevi" },
      },
      required: ["urgency", "category", "sentiment", "summary", "suggestedReplies", "tags"],
    },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: "tool", name: "report" },
      system:
        "Sei l'assistente del dispatcher Service di ZATO, produttore di impianti di triturazione di rottami ferrosi. " +
        "Analizzi le conversazioni con i clienti per aiutare a gestire gli interventi in cantiere. Rispondi sempre in italiano.",
      messages: [
        {
          role: "user",
          content:
            `Contesto: cliente=${context.customer ?? "n/d"}, macchina=${context.machine ?? "n/d"}, intervento=${context.intervento ?? "n/d"}.\n\n` +
            `Conversazione:\n${transcript}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; input?: ChatAnalysis }[] };
  const block = (data.content ?? []).find((b) => b.type === "tool_use");
  if (!block?.input) throw new Error("Nessun output strutturato dall'AI");
  const r = block.input;
  return {
    urgency: Math.max(0, Math.min(1, Number(r.urgency) || 0)),
    category: String(r.category ?? "—"),
    sentiment: String(r.sentiment ?? "—"),
    summary: String(r.summary ?? ""),
    suggestedReplies: Array.isArray(r.suggestedReplies) ? r.suggestedReplies.slice(0, 4).map(String) : [],
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 8).map(String) : [],
  };
}
