import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { fetchFeedHtml } from "@/lib/presenceFeed";

/**
 * Diagnostica integrazione timbratore: esegue il login e mostra la struttura
 * della pagina /stampings (tabelle + eventuali URL AJAX), per capire come
 * estrarre le timbrature. Solo per setup; ritorna text/plain.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new NextResponse("Non autorizzato", { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return new NextResponse("Permesso negato", { status: 403 });

  // ?url= per ispezionare altre pagine del timbratore (es. operatori). Stesso host del feed.
  const urlParam = new URL(req.url).searchParams.get("url") || undefined;
  if (urlParam) {
    try {
      const feedHost = new URL(process.env.PRESENCE_FEED_URL || "").host;
      if (new URL(urlParam).host !== feedHost)
        return new NextResponse("URL non consentito (host diverso dal timbratore)", { status: 400 });
    } catch {
      return new NextResponse("URL non valido", { status: 400 });
    }
  }

  try {
    const { status, contentType, body } = await fetchFeedHtml(urlParam);

    // estrai le tabelle
    const tables = body.match(/<table[\s\S]*?<\/table>/gi) ?? [];
    const firstTable = tables[0] ?? "(nessuna <table> trovata)";

    // cerca possibili URL di dati (ajax / datatables / fetch)
    const urls = new Set<string>();
    for (const m of body.matchAll(/(?:ajax|url|dataUrl|data-url|action|fetch\()\s*[:=(]\s*["'`]([^"'`]+)["'`]/gi)) {
      const v = m[1];
      if (/stamp|timbr|data|list|json|ajax/i.test(v)) urls.add(v);
    }

    const out = [
      `STATUS: ${status}   CONTENT-TYPE: ${contentType}`,
      `Lunghezza HTML: ${body.length} caratteri`,
      `Tabelle trovate: ${tables.length}`,
      "",
      "=== Possibili URL dati (ajax/datatable) ===",
      urls.size ? [...urls].join("\n") : "(nessuno individuato automaticamente)",
      "",
      "=== Prima <table> (troncata 6000 char) ===",
      firstTable.slice(0, 6000),
      "",
      "=== <head> (troncato 1500 char) ===",
      (body.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? "").slice(0, 1500),
    ].join("\n");

    return new NextResponse(out, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (e) {
    return new NextResponse(
      `ERRORE: ${e instanceof Error ? e.message : String(e)}`,
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }
}
