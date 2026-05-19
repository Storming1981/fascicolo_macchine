import { NextResponse } from "next/server";
import { currentUser, verifyPin } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile, saveDataUrl, sha256 } from "@/lib/uploads";
import type { DiaryPhase, SignMethod } from "@prisma/client";

const PHASES: DiaryPhase[] = [
  "PRODUCTION",
  "TESTING",
  "SHIPPED",
  "INSTALLED",
  "MAINTENANCE",
  "SCRAPPED",
];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.intervention")))
    return NextResponse.json({ error: "Permesso negato per registrare interventi" }, { status: 403 });
  const { id } = await ctx.params;

  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const form = await req.formData();
  const phase = String(form.get("phase") || "MAINTENANCE") as DiaryPhase;
  const type = String(form.get("type") || "note");
  const title = String(form.get("title") || "").trim();
  const note = String(form.get("note") || "").trim() || null;
  const actorName = String(form.get("actorName") || user.name).trim();
  const oldSerial = String(form.get("oldSerial") || "").trim() || null;
  const newSerial = String(form.get("newSerial") || "").trim() || null;
  const componentItemId = String(form.get("componentItemId") || "").trim() || null;
  const componentRef = String(form.get("componentRef") || "").trim() || null;
  const signMethod = String(form.get("signMethod") || "") as SignMethod | "";
  const pin = String(form.get("pin") || "");
  const signatureData = String(form.get("signatureData") || "");

  if (!title) return NextResponse.json({ error: "Titolo obbligatorio" }, { status: 400 });
  if (!PHASES.includes(phase))
    return NextResponse.json({ error: "Fase non valida" }, { status: 400 });

  // Verifica firma
  let signature: { method: SignMethod; imageData?: string; image?: string } | null = null;
  if (signMethod === "PIN") {
    if (!user.pinHash || !(await verifyPin(pin, user.pinHash))) {
      return NextResponse.json({ error: "PIN non valido" }, { status: 401 });
    }
    signature = { method: "PIN" };
  } else if (signMethod === "PEN") {
    if (!signatureData.startsWith("data:image")) {
      return NextResponse.json({ error: "Firma a penna mancante" }, { status: 400 });
    }
    const imgPath = await saveDataUrl(signatureData, `${machine.code}/firme`, "sig");
    signature = { method: "PEN", image: imgPath };
  }

  const created = await prisma.diaryEvent.create({
    data: {
      machineId: id,
      phase,
      type,
      title,
      note,
      actorName,
      oldSerial,
      newSerial,
      componentRef,
      authorId: user.id,
    },
  });

  // Sostituzione componente: aggiorna la matricola corrente mantenendo lo storico nel diario
  if (type === "replace" && componentItemId && newSerial) {
    await prisma.componentItem.update({
      where: { id: componentItemId },
      data: {
        serial: newSerial,
        note: `Sostituito il ${new Date().toISOString().slice(0, 10)} (prec. ${oldSerial || "—"})`,
      },
    });
  }

  if (signature) {
    await prisma.signature.create({
      data: {
        machineId: id,
        diaryEventId: created.id,
        role: "Intervento",
        signerName: actorName,
        signerId: user.id,
        method: signature.method,
        imageData: signature.image || null,
        hash: sha256(`${id}|${created.id}|${actorName}|${created.createdAt.toISOString()}`),
      },
    });
  }

  // Foto allegate
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  for (const f of files) {
    const saved = await saveFile(f, `${machine.code}/interventi`);
    await prisma.photo.create({
      data: {
        machineId: id,
        diaryEventId: created.id,
        path: saved.path,
        category: "intervento",
        caption: title,
        authorName: actorName,
        authorId: user.id,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
