import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isErpConfigured, searchErpArticles, type ErpArticle } from "@/lib/erp";
import { prisma } from "@/lib/db";

/**
 * Ricerca articoli/ricambi per l'autocomplete del rapportino.
 *
 * In azienda (LAN) interroga il gestionale in diretta. In produzione (VPS), dove
 * non c'è connessione al SQL Server, ricade sul **catalogo locale** `ErpArticle`
 * popolato dal sync-agent. Stessa logica anche se la query live fallisce.
 */
async function searchLocal(q: string): Promise<ErpArticle[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await prisma.erpArticle.findMany({
    where: {
      OR: [
        { code: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { code: "asc" },
    take: 20,
  });
  return rows.map((r) => ({ code: r.code, description: r.description }));
}

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.sign")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q") ?? "";

  // Gestionale non configurato (VPS) → catalogo locale sincronizzato
  if (!isErpConfigured()) {
    const articles = await searchLocal(q);
    return NextResponse.json({ articles, source: "local" });
  }

  try {
    const articles = await searchErpArticles(q);
    return NextResponse.json({ articles, source: "erp" });
  } catch {
    // Connessione live caduta → ripiego sul catalogo locale se disponibile
    const articles = await searchLocal(q);
    return NextResponse.json({ articles, source: "local" });
  }
}
