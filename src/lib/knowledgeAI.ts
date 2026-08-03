import "server-only";

/**
 * Analisi AI del corpus aziendale (interventi + chat + rapportini) con Claude,
 * per estrarre le PROBLEMATICHE RICORRENTI. Structured output via tool_use.
 * Degrada se ANTHROPIC_API_KEY non è configurata.
 */

const MODEL = process.env.KNOWLEDGE_AI_MODEL || process.env.CHAT_AI_MODEL || "claude-haiku-4-5-20251001";

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type InterventoCorpus = {
  code: string;
  title: string;
  type: string;
  plantType: string | null;
  model: string | null;
  messages: string[]; // testo dei messaggi (chat)
  issues: string[]; // problematiche annotate nei rapportini
};

export type RecurringIssue = {
  theme: string;
  frequency: number;
  affectedModels: string[];
  plantTypes: string[];
  probableCauses: string[];
  recommendations: string[];
};

export type KnowledgeReport = {
  summary: string;
  issues: RecurringIssue[];
};

export async function analyzeRecurringIssues(corpus: InterventoCorpus[]): Promise<KnowledgeReport> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY non configurata");

  const text = corpus
    .map((c) => {
      const lines = [
        `### ${c.code} — ${c.title} [${c.type}${c.plantType ? " · " + c.plantType : ""}${c.model ? " · " + c.model : ""}]`,
      ];
      if (c.issues.length) lines.push("Problematiche: " + c.issues.join(" | "));
      if (c.messages.length) lines.push("Conversazione: " + c.messages.join(" / "));
      return lines.join("\n");
    })
    .join("\n\n")
    .slice(0, 60_000); // limite prudenziale di contesto

  const tool = {
    name: "report",
    description: "Riporta l'analisi strutturata delle problematiche ricorrenti.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Sintesi 2-4 frasi in italiano dei temi principali" },
        issues: {
          type: "array",
          description: "Problematiche ricorrenti ordinate per frequenza decrescente",
          items: {
            type: "object",
            properties: {
              theme: { type: "string", description: "Titolo breve della problematica ricorrente" },
              frequency: { type: "number", description: "Quante volte ricorre nel corpus (stima)" },
              affectedModels: { type: "array", items: { type: "string" }, description: "Modelli/macchine coinvolti" },
              plantTypes: { type: "array", items: { type: "string" }, description: "Tipologie impianto coinvolte" },
              probableCauses: { type: "array", items: { type: "string" }, description: "Cause probabili" },
              recommendations: { type: "array", items: { type: "string" }, description: "Azioni/raccomandazioni" },
            },
            required: ["theme", "frequency", "probableCauses", "recommendations"],
          },
        },
      },
      required: ["summary", "issues"],
    },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      tools: [tool],
      tool_choice: { type: "tool", name: "report" },
      system:
        "Sei l'analista tecnico di ZATO, produttore di impianti di triturazione di rottami ferrosi. " +
        "Analizzi il corpus di interventi service (chat + rapportini) per individuare problematiche " +
        "RICORRENTI, le cause probabili e raccomandazioni utili a prevenirle. Rispondi in italiano.",
      messages: [
        {
          role: "user",
          content: `Corpus di ${corpus.length} interventi:\n\n${text}\n\nIndividua le problematiche ricorrenti.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; input?: KnowledgeReport }[] };
  const block = (data.content ?? []).find((b) => b.type === "tool_use");
  if (!block?.input) throw new Error("Nessun output strutturato dall'AI");
  const r = block.input;
  return {
    summary: String(r.summary ?? ""),
    issues: Array.isArray(r.issues)
      ? r.issues.slice(0, 20).map((i) => ({
          theme: String(i.theme ?? "—"),
          frequency: Number(i.frequency) || 0,
          affectedModels: Array.isArray(i.affectedModels) ? i.affectedModels.map(String) : [],
          plantTypes: Array.isArray(i.plantTypes) ? i.plantTypes.map(String) : [],
          probableCauses: Array.isArray(i.probableCauses) ? i.probableCauses.map(String) : [],
          recommendations: Array.isArray(i.recommendations) ? i.recommendations.map(String) : [],
        }))
      : [],
  };
}
