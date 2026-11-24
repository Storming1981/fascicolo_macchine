import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { deleteUploads, saveFile } from "@/lib/uploads";
import { statusToPhase } from "@/lib/domain";
import { sheetDocDef } from "@/lib/allestimento";
import type { Role } from "@prisma/client";

/** Chi può togliere o riclassificare un allegato: chi lavora sul fascicolo. */
async function canManage(role: Role) {
  return (await userCan(role, "machine.intervention")) || (await userCan(role, "machine.edit"));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { id } = await ctx.params;
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const form = await req.formData();
  const category = String(form.get("category") || "documento");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Nessun file" }, { status: 400 });

  // Casella di una scheda (collaudo dimensionale, rilievo alberi): il
  // caricamento va a diario con il nome della casella, perché è un documento
  // che qualcuno aspetta — a differenza di uno schema allegato per comodità.
  const def = sheetDocDef(category);

  for (const f of files) {
    const saved = await saveFile(f, `${machine.code}/documenti`);
    await prisma.document.create({
      data: {
        machineId: id,
        name: f.name,
        path: saved.path,
        sizeBytes: saved.size,
        category,
      },
    });
    if (def)
      await prisma.diaryEvent.create({
        data: {
          machineId: id,
          phase: statusToPhase(machine.status),
          type: "note",
          title: `${def.label}: documento allegato`,
          note: f.name,
          actorName: user.name,
          authorId: user.id,
        },
      });
  }
  return NextResponse.json({ ok: true, count: files.length });
}

/**
 * Sposta un allegato in una casella di scheda (o lo riporta fra i documenti
 * generici). In officina si carica prima e si archivia dopo: senza questo, un
 * PDF già allegato andrebbe ricaricato per finire nella sua casella, e il
 * fascicolo avrebbe due volte lo stesso file.
 * PATCH { documentId, category }
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await canManage(user.role)))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const { id } = await ctx.params;

  const b = (await req.json().catch(() => null)) as { documentId?: string; category?: string } | null;
  const documentId = String(b?.documentId ?? "");
  const category = String(b?.category ?? "documento") || "documento";
  if (!documentId) return NextResponse.json({ error: "Documento non indicato" }, { status: 400 });

  const machine = await prisma.machine.findUnique({ where: { id }, select: { status: true } });
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!machine || !doc || doc.machineId !== id)
    return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });
  if (doc.category === category) return NextResponse.json({ ok: true, unchanged: true });

  const def = sheetDocDef(category);
  await prisma.$transaction([
    prisma.document.update({ where: { id: documentId }, data: { category } }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "note",
        title: def ? `${def.label}: documento collegato` : "Documento riportato fra gli allegati",
        note: doc.name,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

/**
 * Elimina un allegato del fascicolo. Un PDF caricato per sbaglio (o nella
 * casella sbagliata) restava lì per sempre: in elenco, nei conteggi e nelle
 * caselle delle schede.
 *
 * Cancellazione **definitiva**, riga e file su disco: a differenza delle foto
 * non c'è un cestino da cui ripescarlo — ma quello che c'era resta scritto a
 * diario (nome, casella, chi e quando), che è ciò che serve per ricostruire
 * cosa è successo.
 * DELETE { documentId }
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await canManage(user.role)))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  const { id } = await ctx.params;

  const b = (await req.json().catch(() => null)) as { documentId?: string } | null;
  const documentId = String(b?.documentId ?? "");
  if (!documentId) return NextResponse.json({ error: "Documento non indicato" }, { status: 400 });

  const machine = await prisma.machine.findUnique({ where: { id }, select: { status: true } });
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!machine || !doc || doc.machineId !== id)
    return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });

  const def = sheetDocDef(doc.category);
  await prisma.$transaction([
    prisma.document.delete({ where: { id: documentId } }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "note",
        title: def ? `${def.label}: documento eliminato` : "Documento allegato eliminato",
        note: `${doc.name} · ${doc.path}`,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  // Il file su disco va via dopo la riga: se la cancellazione fallisse
  // resterebbe un allegato che punta a un file che non c'è più.
  await deleteUploads([doc.path]);
  return NextResponse.json({ ok: true });
}
