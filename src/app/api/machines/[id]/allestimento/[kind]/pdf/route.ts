import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isSheetKind } from "@/lib/allestimento";
import { renderSheetPdf } from "@/lib/allestimentoRender";

/**
 * PDF della scheda di allestimento, sempre rigenerato dai dati correnti del
 * fascicolo (scheda + componenti + matricole). `?dl=1` forza il download.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const { id, kind: rawKind } = await ctx.params;
  const kind = rawKind.toUpperCase();
  if (!isSheetKind(kind)) return NextResponse.json({ error: "Scheda non valida" }, { status: 400 });

  const out = await renderSheetPdf(id, kind);
  if (!out) return NextResponse.json({ error: "Scheda non disponibile per questa macchina" }, { status: 404 });

  const dl = new URL(req.url).searchParams.get("dl") === "1";
  return new NextResponse(Buffer.from(out.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${dl ? "attachment" : "inline"}; filename="${out.filename}"`,
      "cache-control": "no-store",
    },
  });
}
