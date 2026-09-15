import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { hasAllestimentoSheets, isSheetKind, sheetCommessa } from "@/lib/allestimento";
import { loadSheet } from "@/lib/allestimentoService";
import { generateAllestimentoPdf } from "@/lib/allestimentoPdf";

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

  const s = await loadSheet(id, kind);
  if (!s) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });
  if (!hasAllestimentoSheets(s.machine.plantType))
    return NextResponse.json({ error: "Schede di allestimento disponibili solo per i BLUE DEVIL" }, { status: 400 });

  const m = s.machine;
  const bytes = await generateAllestimentoPdf({
    kind,
    machineCode: m.code,
    commessa: sheetCommessa(kind, m),
    country: m.country,
    header: s.header,
    model: m.model,
    values: s.values,
    components: m.components.map((c) => ({ groupId: c.groupId, serials: c.items.map((i) => i.serial ?? "") })),
    compilerName: s.compilerName,
    compiledAt: s.compiledAt,
    compilerSignature: s.compilerSignature,
  });

  const filename = `${kind === "CONTAINER" ? "M5.17_Scheda_container" : "M5.16_Scheda_trituratore"}_${sheetCommessa(kind, m)}.pdf`
    .replace(/[^\w.\-]+/g, "_");
  const dl = new URL(req.url).searchParams.get("dl") === "1";
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${dl ? "attachment" : "inline"}; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
