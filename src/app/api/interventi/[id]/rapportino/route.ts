import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile, saveDataUrl, sha256 } from "@/lib/uploads";

type RicambioLine = { code: string; desc: string; qty: string; note: string };

function parseRicambi(raw: string): RicambioLine[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r) => ({
        code: String(r.code ?? "").trim(),
        desc: String(r.desc ?? "").trim(),
        qty: String(r.qty ?? "").trim(),
        note: String(r.note ?? "").trim(),
      }))
      .filter((r) => r.code || r.desc);
  } catch {
    return [];
  }
}

/**
 * Salva / chiude un RAPPORTINO GIORNALIERO di un intervento (un intervento può
 * avere più rapportini, uno per giornata).
 * multipart form-data: rapportinoId? (per aggiornarne uno esistente), date,
 * workDescription, ricambi(json), hoursWorked, techName, clientName,
 * techSignature(dataURL), clientSignature(dataURL), photos[], finalize.
 * Con finalize=1 e macchina collegata → genera l'evento di manutenzione del
 * giorno nel diario del fascicolo (NON completa l'intervento: è multi-giorno).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.sign")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    include: { machine: { select: { id: true, code: true } } },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const form = await req.formData();
  const rapportinoId = String(form.get("rapportinoId") || "").trim() || null;
  const dateStr = String(form.get("date") || "").trim();
  const workDescription = String(form.get("workDescription") || "").trim() || null;
  const ricambi = parseRicambi(String(form.get("ricambi") || "[]"));
  const hoursRaw = String(form.get("hoursWorked") || "").trim();
  const hoursWorked = hoursRaw ? Number(hoursRaw.replace(",", ".")) : null;
  const techName = String(form.get("techName") || user.name).trim();
  const clientName = String(form.get("clientName") || "").trim() || null;
  const techSigData = String(form.get("techSignature") || "");
  const clientSigData = String(form.get("clientSignature") || "");
  const finalize = String(form.get("finalize") || "") === "1";

  const editNote = String(form.get("editNote") || "").trim() || null;
  let existing = null;
  if (rapportinoId) {
    existing = await prisma.rapportino.findFirst({ where: { id: rapportinoId, interventoId: id } });
    if (!existing) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });
  }
  // modifica di un rapportino GIÀ FIRMATO: consentita, ma tracciata in un log
  const wasClosed = existing?.closed === true;

  const scope = intervento.machine?.code ? `${intervento.machine.code}/interventi` : `service/${intervento.code}`;

  let techSigPath = existing?.techSignature ?? null;
  if (techSigData.startsWith("data:image")) techSigPath = await saveDataUrl(techSigData, scope, "sig-tech");
  let clientSigPath = existing?.clientSignature ?? null;
  if (clientSigData.startsWith("data:image")) clientSigPath = await saveDataUrl(clientSigData, scope, "sig-cli");

  if (finalize && !techSigPath)
    return NextResponse.json({ error: "La firma del tecnico è obbligatoria per chiudere la giornata." }, { status: 400 });

  const now = new Date();
  const date = dateStr ? new Date(dateStr) : existing?.date ?? now;

  const fields = {
    date,
    workDescription,
    ricambi,
    hoursWorked: hoursWorked != null && !Number.isNaN(hoursWorked) ? hoursWorked : null,
    techName,
    techSignature: techSigPath,
    techSignedAt: techSigPath ? existing?.techSignedAt ?? now : null,
    clientName,
    clientSignature: clientSigPath,
    clientSignedAt: clientSigPath ? existing?.clientSignedAt ?? now : null,
  };

  // Se sto modificando un rapportino già firmato, salvo prima lo stato precedente nel log.
  if (wasClosed && existing) {
    await prisma.rapportinoRevision.create({
      data: {
        rapportinoId: existing.id,
        editedById: user.id,
        editedByName: user.name,
        note: editNote,
        snapshot: {
          date: existing.date.toISOString(),
          workDescription: existing.workDescription,
          ricambi: existing.ricambi,
          hoursWorked: existing.hoursWorked,
          techName: existing.techName,
          clientName: existing.clientName,
        },
      },
    });
  }

  const rapportino = existing
    ? await prisma.rapportino.update({ where: { id: existing.id }, data: fields })
    : await prisma.rapportino.create({ data: { interventoId: id, ...fields } });

  // Modifica di un rapportino chiuso: resta chiuso, aggiorna l'evento del diario collegato.
  if (wasClosed && existing) {
    if (existing.diaryEventId) {
      const giorno = date.toLocaleDateString("it-IT");
      await prisma.diaryEvent.update({
        where: { id: existing.diaryEventId },
        data: {
          title: `Intervento ${intervento.code} — ${giorno}: ${intervento.title}`,
          note: workDescription,
          date,
        },
      }).catch(() => null);
    }
    // le eventuali nuove foto vanno comunque agganciate al fascicolo/evento
    const files0 = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    for (const f of files0) {
      const saved = await saveFile(f, scope);
      await prisma.photo.create({
        data: {
          interventoId: id,
          machineId: intervento.machine?.id ?? null,
          diaryEventId: existing.diaryEventId,
          path: saved.path,
          category: "intervento",
          caption: intervento.title,
          authorName: techName,
          authorId: user.id,
        },
      });
    }
    return NextResponse.json({ ok: true, edited: true, rapportinoId: rapportino.id });
  }

  // Foto → create, raccogli gli id per collegarle poi al diario
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const newPhotoIds: string[] = [];
  for (const f of files) {
    const saved = await saveFile(f, scope);
    const p = await prisma.photo.create({
      data: {
        interventoId: id,
        machineId: intervento.machine?.id ?? null,
        path: saved.path,
        category: "intervento",
        caption: intervento.title,
        authorName: techName,
        authorId: user.id,
      },
    });
    newPhotoIds.push(p.id);
  }

  if (!finalize) return NextResponse.json({ ok: true, finalized: false, rapportinoId: rapportino.id });

  // --- Chiusura giornaliera → evento nel diario del fascicolo (del giorno) ---
  let diaryEventId: string | null = rapportino.diaryEventId;
  const hash = sha256(`${id}|${rapportino.id}|${techName}|${now.toISOString()}`);

  if (intervento.machine?.id && !diaryEventId) {
    const giorno = date.toLocaleDateString("it-IT");
    const event = await prisma.diaryEvent.create({
      data: {
        machineId: intervento.machine.id,
        phase: "MAINTENANCE",
        type: "repair",
        title: `Intervento ${intervento.code} — ${giorno}: ${intervento.title}`,
        note: workDescription,
        date,
        actorName: techName,
        authorId: user.id,
      },
    });
    diaryEventId = event.id;

    await prisma.signature.create({
      data: {
        machineId: intervento.machine.id,
        diaryEventId: event.id,
        role: "Intervento campo",
        signerName: techName,
        signerId: user.id,
        method: "PEN",
        imageData: techSigPath,
        hash,
      },
    });

    if (newPhotoIds.length)
      await prisma.photo.updateMany({
        where: { id: { in: newPhotoIds } },
        data: { machineId: intervento.machine.id, diaryEventId: event.id },
      });
  }

  await prisma.rapportino.update({ where: { id: rapportino.id }, data: { closed: true, hash, diaryEventId } });

  return NextResponse.json({ ok: true, finalized: true, rapportinoId: rapportino.id, linkedToMachine: !!intervento.machine?.id });
}

/** Elimina un rapportino giornaliero (solo se in bozza). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.sign")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const rapportinoId = new URL(req.url).searchParams.get("rapportinoId");
  if (!rapportinoId) return NextResponse.json({ error: "rapportinoId mancante" }, { status: 400 });
  const r = await prisma.rapportino.findFirst({ where: { id: rapportinoId, interventoId: id } });
  if (!r) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });
  if (r.closed) return NextResponse.json({ error: "Un rapportino chiuso non può essere eliminato" }, { status: 400 });
  await prisma.rapportino.delete({ where: { id: rapportinoId } });
  return NextResponse.json({ ok: true });
}
