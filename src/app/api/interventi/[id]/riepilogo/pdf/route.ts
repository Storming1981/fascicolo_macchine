import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { renderRiepilogoPdf } from "@/lib/riepilogoRender";

/**
 * PDF riepilogativo dell'intervento: tutte le giornate di fila, firma unica in
 * fondo. Rigenerato dai dati correnti. `?dl=1` per forzare il download.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const out = await renderRiepilogoPdf(id);
  if (!out)
    return NextResponse.json({ error: "Nessuna giornata da riepilogare" }, { status: 404 });

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
