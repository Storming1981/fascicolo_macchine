import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/uploads";
import { POS_CATEGORY } from "@/lib/domain";

const CATEGORIES = [POS_CATEGORY, "allegato", "sicurezza", "formazione", "dpi", "altro"];

/**
 * Documenti allegati a un intervento (upload manuale). I documenti dei tecnici
 * recuperati dal fascicolo TeamSystem avranno `source = "TEAMSYSTEM"` e
 * `userId` valorizzato: qui si gestisce solo il caricamento manuale.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: { id: true, code: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const form = await req.formData();
  const rawCat = String(form.get("category") || "allegato");
  const category = CATEGORIES.includes(rawCat) ? rawCat : "allegato";
  const userId = String(form.get("userId") || "").trim() || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Nessun file" }, { status: 400 });

  // Il P.O.S. è uno solo per intervento (ed è il documento che sblocca la
  // pianificazione): per sostituirlo va prima eliminato quello esistente.
  if (category === POS_CATEGORY) {
    if (files.length > 1)
      return NextResponse.json({ error: "Carica un solo file per il P.O.S." }, { status: 400 });
    const already = await prisma.interventoDocument.count({
      where: { interventoId: id, category: POS_CATEGORY },
    });
    if (already)
      return NextResponse.json(
        { error: "P.O.S. già presente: elimina quello esistente per sostituirlo." },
        { status: 409 }
      );
  }

  const scope = `service/${intervento.code}/documenti`;
  const created: { id: string; name: string; path: string }[] = [];
  for (const f of files) {
    const saved = await saveFile(f, scope);
    const rec = await prisma.interventoDocument.create({
      data: {
        interventoId: id,
        name: f.name || "documento",
        path: saved.path,
        mimeType: f.type || null,
        sizeBytes: saved.size,
        category,
        source: "UPLOAD",
        userId,
        uploadedById: user.id,
        uploadedByName: user.name,
      },
    });
    created.push({ id: rec.id, name: rec.name, path: rec.path });
  }
  return NextResponse.json({ ok: true, count: created.length, documents: created });
}

/** Elimina un documento allegato (non quelli sincronizzati da TeamSystem). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const docId = new URL(req.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId mancante" }, { status: 400 });

  const doc = await prisma.interventoDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.interventoId !== id)
    return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
  if (doc.source === "TEAMSYSTEM")
    return NextResponse.json(
      { error: "I documenti sincronizzati da TeamSystem non si eliminano da qui" },
      { status: 400 }
    );
  // Il P.O.S. validato è la base della pianificazione: prima si revoca la
  // validazione (che riporta l'intervento in "Documentazione da validare"),
  // poi si può sostituire il file.
  if (doc.category === POS_CATEGORY) {
    const iv = await prisma.intervento.findUnique({
      where: { id },
      select: { posValidated: true },
    });
    if (iv?.posValidated)
      return NextResponse.json(
        { error: "P.O.S. validato: revoca prima la validazione del responsabile." },
        { status: 409 }
      );
  }

  await prisma.interventoDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
