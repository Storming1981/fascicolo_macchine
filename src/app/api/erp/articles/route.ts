import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { isErpConfigured, searchErpArticles } from "@/lib/erp";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.sign")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isErpConfigured())
    return NextResponse.json({ error: "Gestionale non configurato", articles: [] }, { status: 503 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const articles = await searchErpArticles(q);
    return NextResponse.json({ articles });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore gestionale", articles: [] },
      { status: 502 }
    );
  }
}
