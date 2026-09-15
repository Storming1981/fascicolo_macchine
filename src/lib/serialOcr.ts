import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropic } from "./brain/client";

/**
 * Lettura della MATRICOLA dalla foto della targhetta di un componente.
 *
 * Perché non basta "estrai il numero di serie" su Haiku (la prima versione):
 * - le targhette ZATO (riduttori) in foto sono quasi sempre ruotate di 90° o
 *   capovolte, e accanto alla matricola hanno tipo (GB.26004.FS) e rapporto
 *   (1:400): il modello piccolo sceglieva il codice sbagliato o sbagliava cifre;
 * - la matricola ha zeri iniziali (07260734) che vanno tenuti.
 * Quindi: modello forte, istruzioni sulle etichette tipiche, output JSON con
 * l'etichetta da cui è stato letto il valore e tutti i codici visti.
 */

export const SERIAL_OCR_MODEL = process.env.VISION_AI_MODEL || "claude-opus-5";

export type SerialOcrResult = {
  /** Matricola letta, "" se non individuata. */
  serial: string;
  /** Etichetta stampata accanto alla matricola (es. "NR.MATRICOLA - REGISTRATION NR"). */
  label: string;
  confidence: "high" | "medium" | "low";
  /** Tutti i codici leggibili sulla targhetta, con la loro etichetta. */
  candidates: { label: string; value: string }[];
};

const SYSTEM = `Leggi targhette identificative di componenti industriali (riduttori, motori idraulici, pompe, motori elettrici, cilindri) fotografate con il telefono in officina. Il tuo compito è trovare la MATRICOLA del componente, cioè il suo numero di serie univoco.

Come si presenta la foto:
- la targhetta può essere ruotata di 90°, capovolta o in prospettiva: leggila nel suo verso corretto prima di trascrivere;
- può esserci sporco, vernice, riflessi: se una cifra è davvero illeggibile abbassa la confidenza, non inventarla.

Dove sta la matricola: è il valore accanto a etichette come NR. MATRICOLA, MATRICOLA, MATR., N° MATRICOLA, REGISTRATION NR, SERIAL NO., SERIAL-NO., SERIAL NUMBER, S/N, SN, SER. NO., N° SERIE, NUMERO DI SERIE, FABR.-NR., FERTIGUNGSNUMMER, SERIENNUMMER, N° DE SÉRIE.

Cosa NON è la matricola, anche se è un codice ben visibile: tipo o modello (TYPE, TIPO, RIDUT. TIPO, GEARBOX TYPE, MODEL), codice articolo o d'ordine (PART NO., ART., CODE, ORDER NO., ID NO.), rapporto di riduzione (RATIO, es. 1:400), date, pressioni, cilindrate, potenze, tensioni, indirizzo e telefono del costruttore, contenuto di codici a barre o DataMatrix.

Trascrizione:
- copia la matricola esattamente carattere per carattere, compresi zeri iniziali, lettere, trattini e barre; niente spazi aggiunti;
- nelle matricole numeriche non confondere 0/O, 1/I, 5/S, 8/B: usa il contesto degli altri caratteri;
- se sulla targhetta non c'è un'etichetta di matricola riconoscibile, lascia serial vuoto e confidence "low", salvo che esista un unico codice che per forma sia inequivocabilmente un numero di serie.

Elenca in candidates tutti i codici che riesci a leggere, ciascuno con la sua etichetta.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["serial", "label", "confidence", "candidates"],
  properties: {
    serial: { type: "string", description: "Matricola esatta, stringa vuota se non individuata" },
    label: { type: "string", description: "Etichetta stampata accanto alla matricola" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
  },
} as const;

type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function readSerialFromImage(base64: string, mediaType: ImageMedia): Promise<SerialOcrResult> {
  const client = requireAnthropic();
  const res = await client.messages.create({
    model: SERIAL_OCR_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Qual è la matricola di questo componente?" },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("Lettura rifiutata dal modello");
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("Nessuna risposta dal modello");
  const out = JSON.parse(text) as SerialOcrResult;
  // Il modello copia la matricola com'è; qui si toglie solo lo spazio accidentale.
  out.serial = out.serial.replace(/\s+/g, "").trim();
  return out;
}
