import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { apiKey } from "@/lib/brain/config";
import { aiErrorMessage } from "@/lib/brain/client";
import { readSerialFromImage } from "@/lib/serialOcr";

const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/**
 * OCR "matricola da foto": legge il numero di matricola/serie dalla foto della
 * targhetta di un componente (vedi `src/lib/serialOcr.ts`). Ritorna
 * { serial, label, confidence, candidates }; il salvataggio lo decide il client.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  if (!apiKey()) return NextResponse.json({ error: "Riconoscimento AI non configurato" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0)
    return NextResponse.json({ error: "Nessuna foto" }, { status: 400 });
  // Il client riduce già la foto; se arriva comunque troppo grande (browser che
  // non decodifica il formato) meglio un messaggio chiaro che un 400 dell'API.
  if (file.size > 3.7 * 1024 * 1024)
    return NextResponse.json({ error: "Foto troppo grande per la lettura: riprova con uno scatto JPEG" }, { status: 413 });
  const mediaType = (OK_TYPES as readonly string[]).includes(file.type)
    ? (file.type as (typeof OK_TYPES)[number])
    : "image/jpeg";
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    return NextResponse.json(await readSerialFromImage(b64, mediaType));
  } catch (e) {
    return NextResponse.json({ error: aiErrorMessage(e) }, { status: 502 });
  }
}
