import { NextResponse } from "next/server";
import { currentUser, verifyPin } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveDataUrl, sha256 } from "@/lib/uploads";
import type { SignMethod } from "@prisma/client";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "machine.sign")))
    return NextResponse.json({ error: "Permesso negato per firmare" }, { status: 403 });
  const { id } = await ctx.params;

  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const b = await req.json();
  const role = String(b.role || "").trim();
  const signerName = String(b.signerName || user.name).trim();
  const method = String(b.method || "PEN") as SignMethod;
  if (!role) return NextResponse.json({ error: "Ruolo firma mancante" }, { status: 400 });

  let imageData: string | null = null;
  if (method === "PIN") {
    if (!user.pinHash || !(await verifyPin(String(b.pin || ""), user.pinHash))) {
      return NextResponse.json({ error: "PIN non valido" }, { status: 401 });
    }
  } else {
    if (!String(b.signatureData || "").startsWith("data:image")) {
      return NextResponse.json({ error: "Firma a penna mancante" }, { status: 400 });
    }
    imageData = await saveDataUrl(b.signatureData, `${machine.code}/firme`, "collaudo");
  }

  // Una firma per ruolo per macchina: aggiorna se già presente
  const existing = await prisma.signature.findFirst({
    where: { machineId: id, role, diaryEventId: null },
  });
  const hash = sha256(`${id}|${role}|${signerName}|${Date.now()}`);
  if (existing) {
    await prisma.signature.update({
      where: { id: existing.id },
      data: { signerName, signerId: user.id, method, imageData, hash, signedAt: new Date() },
    });
  } else {
    await prisma.signature.create({
      data: {
        machineId: id,
        role,
        signerName,
        signerId: user.id,
        method,
        imageData,
        hash,
      },
    });
  }

  await prisma.diaryEvent.create({
    data: {
      machineId: id,
      phase: "TESTING",
      type: "milestone",
      title: `Firma verbale — ${role}`,
      note: `Firmato da ${signerName} (${method === "PIN" ? "PIN" : "firma a penna"}).`,
      actorName: signerName,
      authorId: user.id,
    },
  });

  return NextResponse.json({ ok: true });
}
