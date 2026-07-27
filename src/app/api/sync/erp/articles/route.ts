import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSyncRequest, isSyncConfigured } from "@/lib/syncAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync/erp/articles
 *
 * Riceve dal sync-agent il catalogo articoli/ricambi dal gestionale (tabella
 * `artico`) e lo salva in `ErpArticle`, così l'autocomplete del rapportino
 * funziona anche sulla VPS (senza connessione diretta al SQL Server).
 *
 * Body:
 *   { articles: Array<{ code: string, description?: string }>, replace?: boolean }
 *
 * L'agent invia a chunk: il PRIMO chunk con `replace:true` azzera il catalogo,
 * i successivi accodano. Autenticazione: Bearer sk_sync_ (SYNC_API_KEY).
 */
export async function POST(req: Request) {
  if (!isSyncConfigured())
    return NextResponse.json({ error: "Sync non configurato" }, { status: 503 });
  if (!isValidSyncRequest(req))
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  let body: { articles?: { code?: unknown; description?: unknown }[]; replace?: boolean } | null =
    null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.articles))
    return NextResponse.json({ error: "Campo 'articles' mancante" }, { status: 400 });

  // Normalizza + dedup per codice (l'ultimo vince)
  const byCode = new Map<string, string>();
  for (const a of body.articles) {
    const code = typeof a?.code === "string" ? a.code.trim() : "";
    if (!code) continue;
    const desc = typeof a?.description === "string" ? a.description.trim() : "";
    byCode.set(code, desc);
  }
  const rows = Array.from(byCode, ([code, description]) => ({ code, description }));

  if (body.replace) {
    await prisma.erpArticle.deleteMany({});
  }

  let inserted = 0;
  // createMany a blocchi: skipDuplicates evita conflitti sui codici già presenti
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await prisma.erpArticle.createMany({
      data: rows.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    inserted += res.count;
  }

  const total = await prisma.erpArticle.count();
  return NextResponse.json({
    status: "success",
    received: body.articles.length,
    inserted,
    totalInCatalog: total,
  });
}
