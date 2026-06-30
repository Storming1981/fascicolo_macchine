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
 * Salva / chiude il rapportino di un intervento.
 * multipart form-data: workDescription, ricambi(json), hoursWorked, techName,
 * clientName, techSignature(dataURL), clientSignature(dataURL), photos[], finalize.
 * Con finalize=1 e intervento collegato a una macchina → genera l'evento di
 * manutenzione nel diario del fascicolo (DiaryEvent + Signature + foto).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "intervento.edit")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    include: { rapportino: true, machine: { select: { id: true, code: true } } },
  });
  if (!intervento)
    return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });
  if (intervento.rapportino?.closed)
    return NextResponse.json({ error: "Rapportino già chiuso" }, { status: 409 });

  const form = await req.formData();
  const workDescription = String(form.get("workDescription") || "").trim() || null;
  const ricambi = parseRicambi(String(form.get("ricambi") || "[]"));
  const hoursRaw = String(form.get("hoursWorked") || "").trim();
  const hoursWorked = hoursRaw ? Number(hoursRaw.replace(",", ".")) : null;
  const techName = String(form.get("techName") || user.name).trim();
  const clientName = String(form.get("clientName") || "").trim() || null;
  const techSigData = String(form.get("techSignature") || "");
  const clientSigData = String(form.get("clientSignature") || "");
  const finalize = String(form.get("finalize") || "") === "1";

  const scope = intervento.machine?.code
    ? `${intervento.machine.code}/interventi`
    : `service/${intervento.code}`;

  // Firme (dataURL → file)
  let techSigPath = intervento.rapportino?.techSignature ?? null;
  if (techSigData.startsWith("data:image")) {
    techSigPath = await saveDataUrl(techSigData, scope, "sig-tech");
  }
  let clientSigPath = intervento.rapportino?.clientSignature ?? null;
  if (clientSigData.startsWith("data:image")) {
    clientSigPath = await saveDataUrl(clientSigData, scope, "sig-cli");
  }

  if (finalize && !techSigPath)
    return NextResponse.json(
      { error: "La firma del tecnico è obbligatoria per chiudere il rapportino." },
      { status: 400 }
    );

  const now = new Date();

  // Upsert del rapportino
  const rapportino = await prisma.rapportino.upsert({
    where: { interventoId: id },
    update: {
      workDescription,
      ricambi,
      hoursWorked: hoursWorked != null && !Number.isNaN(hoursWorked) ? hoursWorked : null,
      techName,
      techSignature: techSigPath,
      techSignedAt: techSigPath ? intervento.rapportino?.techSignedAt ?? now : null,
      clientName,
      clientSignature: clientSigPath,
      clientSignedAt: clientSigPath ? intervento.rapportino?.clientSignedAt ?? now : null,
    },
    create: {
      interventoId: id,
      workDescription,
      ricambi,
      hoursWorked: hoursWorked != null && !Number.isNaN(hoursWorked) ? hoursWorked : null,
      techName,
      techSignature: techSigPath,
      techSignedAt: techSigPath ? now : null,
      clientName,
      clientSignature: clientSigPath,
      clientSignedAt: clientSigPath ? now : null,
    },
  });

  // Foto allegate all'intervento
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  for (const f of files) {
    const saved = await saveFile(f, scope);
    await prisma.photo.create({
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
  }

  if (!finalize) return NextResponse.json({ ok: true, finalized: false });

  // --- Chiusura: collega al fascicolo macchina se presente ---
  let diaryEventId: string | null = rapportino.diaryEventId;
  const hash = sha256(`${id}|${intervento.code}|${techName}|${now.toISOString()}`);

  if (intervento.machine?.id && !diaryEventId) {
    const event = await prisma.diaryEvent.create({
      data: {
        machineId: intervento.machine.id,
        phase: "MAINTENANCE",
        type: "repair",
        title: `Intervento ${intervento.code}: ${intervento.title}`,
        note: workDescription,
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

    // collega le foto dell'intervento al diario del fascicolo
    await prisma.photo.updateMany({
      where: { interventoId: id },
      data: { machineId: intervento.machine.id, diaryEventId: event.id },
    });
  }

  await prisma.rapportino.update({
    where: { interventoId: id },
    data: { closed: true, hash, diaryEventId },
  });

  // l'intervento passa a COMPLETATO
  await prisma.intervento.update({
    where: { id },
    data: { status: "COMPLETATO", completedAt: now },
  });

  return NextResponse.json({ ok: true, finalized: true, linkedToMachine: !!intervento.machine?.id });
}
