import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";

const MODEL = process.env.VISION_AI_MODEL || process.env.CHAT_AI_MODEL || "claude-haiku-4-5-20251001";
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * OCR "matricola da foto": legge il numero di matricola/serie dalla foto della
 * targhetta di un componente usando Claude vision. Ritorna { serial } (stringa
 * pulita) come SUGGERIMENTO, sempre modificabile dall'operatore.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Riconoscimento AI non configurato" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0)
    return NextResponse.json({ error: "Nessuna foto" }, { status: 400 });
  const mediaType = OK_TYPES.includes(file.type) ? file.type : "image/jpeg";
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 60,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
              {
                type: "text",
                text:
                  "Questa è la foto della targhetta/etichetta di un componente industriale. " +
                  "Estrai SOLO il numero di matricola / numero di serie (serial number / S/N / Matr.). " +
                  "Rispondi esclusivamente con il codice, senza altre parole. " +
                  "Se non è leggibile con certezza, rispondi esattamente: NONE.",
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: `Errore AI (${res.status})`, detail: t.slice(0, 200) }, { status: 502 });
    }
    const data = await res.json();
    const raw: string = (data?.content?.[0]?.text ?? "").trim();
    const serial = raw && raw.toUpperCase() !== "NONE" ? raw.replace(/\s+/g, " ").trim() : "";
    return NextResponse.json({ serial });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore AI" }, { status: 502 });
  }
}
