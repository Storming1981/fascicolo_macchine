import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { statusToPhase } from "@/lib/domain";
import { anagraficaFields } from "@/lib/machineProgress";

/**
 * Convalida dell'anagrafica del fascicolo: la firma di chi dichiara che le card
 * *Anagrafica macchina* e *Cliente e destinazione* sono compilate e corrette.
 *
 * POST   { signature?, saveSignature? } → firma (disegnata ora o quella personale).
 * DELETE                                → revoca la convalida.
 *
 * La firma **decade da sola** se l'anagrafica viene modificata dopo
 * (`PATCH /api/machines/[id]`): una convalida che sopravvive alle correzioni
 * non convaliderebbe più niente.
 * Permesso: `machine.edit`, lo stesso che apre il pulsante *Modifica*.
 */

const SIGN_SELECT = {
  id: true,
  status: true,
  plantType: true,
  model: true,
  year: true,
  job: true,
  jobBody: true,
  jobContainer: true,
  customer: true,
  country: true,
  site: true,
  productionStart: true,
  deliveryDate: true,
  erpBodyOrder: true,
  erpContainerOrder: true,
  anagraficaSignedByName: true,
  anagraficaSignedAt: true,
} as const;

async function guard(id: string) {
  const user = await currentUser();
  if (!user) return { err: NextResponse.json({ error: "Non autorizzato" }, { status: 401 }) };
  if (!(await userCan(user.role, "machine.edit")))
    return { err: NextResponse.json({ error: "Permesso negato" }, { status: 403 }) };
  const machine = await prisma.machine.findUnique({ where: { id }, select: SIGN_SELECT });
  if (!machine) return { err: NextResponse.json({ error: "Macchina non trovata" }, { status: 404 }) };
  return { user, machine };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if (g.err) return g.err;
  const { user, machine } = g;

  // Si convalida un'anagrafica completa: altrimenti la firma direbbe il falso.
  // Gli ordini di produzione (gruppo "ordini") stanno in Analisi ore e non
  // fanno parte di ciò che questa firma attesta.
  const fields = anagraficaFields(machine).filter((f) => f.group !== "ordini");
  const missing = fields.filter((f) => !f.filled);
  if (missing.length)
    return NextResponse.json(
      { error: `Anagrafica incompleta: manca ${missing.map((m) => m.label).join(", ")}.` },
      { status: 400 }
    );

  const b = await req.json().catch(() => null);
  const drawn =
    typeof b?.signature === "string" && b.signature.startsWith("data:image") ? b.signature : null;
  const signature = drawn ?? user.signatureImage ?? null;
  if (!signature)
    return NextResponse.json(
      { error: "Firma mancante. Disegnala ora oppure imposta la firma personale dal profilo." },
      { status: 400 }
    );
  if (drawn && b?.saveSignature === true)
    await prisma.user.update({ where: { id: user.id }, data: { signatureImage: drawn } });

  const now = new Date();
  await prisma.$transaction([
    prisma.machine.update({
      where: { id },
      data: {
        anagraficaSignedById: user.id,
        anagraficaSignedByName: user.name,
        anagraficaSignedAt: now,
        anagraficaSignature: signature,
      },
    }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "milestone",
        title: "Anagrafica convalidata",
        note: `Compilazione dichiarata completa (${fields.length} campi) e firmata.`,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if (g.err) return g.err;
  const { user, machine } = g;
  if (!machine.anagraficaSignedAt) return NextResponse.json({ ok: true, notSigned: true });

  await prisma.$transaction([
    prisma.machine.update({
      where: { id },
      data: {
        anagraficaSignedById: null,
        anagraficaSignedByName: null,
        anagraficaSignedAt: null,
        anagraficaSignature: null,
      },
    }),
    prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: statusToPhase(machine.status),
        type: "note",
        title: "Convalida anagrafica revocata",
        note: `Firmata da ${machine.anagraficaSignedByName ?? "—"}.`,
        actorName: user.name,
        authorId: user.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
