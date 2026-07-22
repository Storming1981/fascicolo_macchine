import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { renderRapportinoPdf } from "@/lib/rapportinoRender";

/**
 * PDF di un rapportino giornaliero (sempre rigenerato dai dati correnti, così è
 * scaricabile anche in bozza e resta aggiornato dopo le modifiche).
 * Query `?dl=1` per forzare il download (Content-Disposition: attachment).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; rid: string }> }
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id, rid } = await ctx.params;
  const rap = await prisma.rapportino.findFirst({
    where: { id: rid, interventoId: id },
    select: { id: true },
  });
  if (!rap) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });

  const out = await renderRapportinoPdf(rid);
  if (!out) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });

  const dl = new URL(req.url).searchParams.get("dl") === "1";
  const disposition = `${dl ? "attachment" : "inline"}; filename="${out.filename}"`;
  return new NextResponse(Buffer.from(out.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": disposition,
      "cache-control": "no-store",
    },
  });
}
