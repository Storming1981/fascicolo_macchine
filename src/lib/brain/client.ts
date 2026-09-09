import Anthropic from "@anthropic-ai/sdk";
import { apiKey, UTILITY_MODEL } from "./config";

let cached: Anthropic | null = null;

/** Client Anthropic condiviso. `null` se la chiave non è configurata: tutte le
 *  funzioni AI degradano con grazia invece di far esplodere la pagina. */
export function anthropic(): Anthropic | null {
  const key = apiKey();
  if (!key) return null;
  if (!cached) cached = new Anthropic({ apiKey: key, maxRetries: 2 });
  return cached;
}

export function requireAnthropic(): Anthropic {
  const c = anthropic();
  if (!c) throw new Error("ANTHROPIC_API_KEY non configurata");
  return c;
}

/** Messaggio d'errore leggibile da mostrare in UI. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Chiave API Claude non valida";
  if (e instanceof Anthropic.RateLimitError) return "Troppe richieste all'AI, riprova fra poco";
  if (e instanceof Anthropic.BadRequestError) return `Richiesta AI non valida: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Errore AI (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : "Errore AI";
}

/**
 * Chiamata "utility": structured output via tool_use su Haiku. Usata per i task
 * ad alto volume (espansione query, descrizione disegni, OCR, titoli) dove
 * contano costo e latenza, non la profondità di ragionamento.
 */
export async function utilityJson<T>(opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  model?: string;
  /** Mette in cache il system prompt: conviene quando è lungo e stabile. */
  cacheSystem?: boolean;
}): Promise<T> {
  const client = requireAnthropic();
  const res = await client.messages.create({
    model: opts.model || UTILITY_MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.cacheSystem
      ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
      : opts.system,
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: opts.schema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: opts.messages,
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("Nessun output strutturato dall'AI");
  return block.input as T;
}
