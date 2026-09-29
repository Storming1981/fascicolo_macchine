import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { canSeeTechDocs } from "@/lib/tecniciDocs";
import { teamsystemConfigured, tsDownload } from "@/lib/teamsystemHr";

/**
 * Apre un documento del fascicolo TeamSystem di un tecnico. Il file non sta
 * sul nostro disco: si scarica al volo e passa in streaming, così le
 * credenziali TeamSystem non escono mai dal server. Si aprono solo documenti
 * già in archivio (`TsEmployeeDoc`), cioè già passati dalla whitelist: un uuid
 * qualunque di TeamSystem (un cedolino) qui non passa.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "service.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!teamsystemConfigured())
    return NextResponse.json({ error: "TeamSystem HR non configurato" }, { status: 503 });

  const { docId } = await ctx.params;
  const doc = await prisma.tsEmployeeDoc.findUnique({
    where: { id: docId },
    include: { user: { select: { tsFiscalCode: true } } },
  });
  if (!doc?.user.tsFiscalCode) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });

  const viewAll = await userCan(user.role, "intervento.viewAll");
  if (!(await canSeeTechDocs(user, doc.userId, viewAll)))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  let res: Response;
  try {
    res = await tsDownload(doc.user.tsFiscalCode, doc.uuid);
  } catch (e) {
    console.error("[teamsystem] download", doc.uuid, e);
    return NextResponse.json({ error: "TeamSystem HR non raggiungibile" }, { status: 502 });
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || type.includes("application/json")) {
    const msg = await res.text().catch(() => "");
    console.error("[teamsystem] download", doc.uuid, res.status, msg.slice(0, 300));
    return NextResponse.json({ error: "Documento non disponibile su TeamSystem" }, { status: 502 });
  }

  const name = doc.fileName.replace(/["\r\n]/g, "");
  const isPdf = /\.pdf$/i.test(name);
  return new Response(res.body, {
    headers: {
      "content-type": isPdf ? "application/pdf" : type || "application/octet-stream",
      // inline: sul telefono il PDF si apre nel visore invece di finire nei download
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      ...(res.headers.get("content-length") ? { "content-length": res.headers.get("content-length")! } : {}),
    },
  });
}
