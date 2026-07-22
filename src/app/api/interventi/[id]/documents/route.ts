import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/uploads";

const CATEGORIES = ["allegato", "sicurezza", "formazione", "dpi", "altro"];

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

  await prisma.interventoDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
