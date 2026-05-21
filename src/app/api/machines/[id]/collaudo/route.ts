import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { CHECKLIST_TRITURATORE } from "@/lib/checklist";
import type { Prisma, CollaudoStatus } from "@prisma/client";

type Answer = { value: "SI" | "NO" | "NA" | null; note?: string };
type AnswersMap = Record<string, Answer>;

function sanitizeAnswers(raw: unknown): AnswersMap {
  const out: AnswersMap = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, { value?: unknown; note?: unknown }>;
  for (const item of CHECKLIST_TRITURATORE) {
    const k = String(item.n);
    const a = r[k];
    if (!a) continue;
    const v = a.value === "SI" || a.value === "NO" || a.value === "NA" ? a.value : null;
    const n = typeof a.note === "string" ? a.note.slice(0, 1000) : "";
    if (v || n) out[k] = { value: v, note: n };
  }
  return out;
}

function allAnswered(answers: AnswersMap): boolean {
  return CHECKLIST_TRITURATORE.every((it) => {
    const a = answers[String(it.n)];
    return !!(a && (a.value === "SI" || a.value === "NO" || a.value === "NA"));
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { id } = await ctx.params;
  const c = await prisma.collaudo.findUnique({ where: { machineId: id } });
  return NextResponse.json({ collaudo: c });
}

/**
 * Salvataggio della check list.
 * Body: { action: "save" | "submit" | "approve", answers?, compilerSignature?, approverSignature?, remarks? }
 * - save:    salva risposte come DRAFT/IN_PROGRESS
 * - submit:  richiede tutte le risposte compilate + firma compilatore → PENDING_APPROVAL
 * - approve: richiede stato PENDING_APPROVAL + firma approvatore → APPROVED
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { id } = await ctx.params;

  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Macchina non trovata" }, { status: 404 });

  const body = await req.json();
  const action = String(body.action || "save");

  const existing = await prisma.collaudo.findUnique({ where: { machineId: id } });

  if (action === "save" || action === "submit") {
    if (!(await userCan(user.role, "machine.intervention"))) {
      return NextResponse.json({ error: "Permesso negato per compilare il collaudo" }, { status: 403 });
    }
    const answers = sanitizeAnswers(body.answers);
    const empty = Object.keys(answers).length === 0;

    if (action === "submit") {
      if (!allAnswered(answers))
        return NextResponse.json({ error: "Tutte le voci devono avere SI / NO / N.A." }, { status: 400 });

      const signature =
        typeof body.compilerSignature === "string" && body.compilerSignature.startsWith("data:image")
          ? body.compilerSignature
          : user.signatureImage || null;
      if (!signature)
        return NextResponse.json(
          { error: "Firma compilatore mancante. Imposta la firma personale o disegnala ora." },
          { status: 400 }
        );

      const saveSig = body.saveSignature === true && typeof body.compilerSignature === "string";
      if (saveSig) {
        await prisma.user.update({
          where: { id: user.id },
          data: { signatureImage: body.compilerSignature },
        });
      }

      const data = {
        status: "PENDING_APPROVAL" as const,
        answers: answers as Prisma.InputJsonValue,
        compilerId: user.id,
        compilerName: user.name,
        compiledAt: new Date(),
        compilerSignature: signature,
      };
      const saved = existing
        ? await prisma.collaudo.update({ where: { machineId: id }, data })
        : await prisma.collaudo.create({ data: { ...data, machineId: id } });

      await prisma.diaryEvent.create({
        data: {
          machineId: id,
          phase: "TESTING",
          type: "milestone",
          title: "Check list di collaudo compilata",
          note: "Verbale di collaudo inviato per approvazione.",
          actorName: user.name,
          authorId: user.id,
        },
      });

      return NextResponse.json({ ok: true, status: saved.status });
    }

    // save (draft)
    const nextStatus: CollaudoStatus =
      existing?.status === "APPROVED" || existing?.status === "PENDING_APPROVAL"
        ? existing.status
        : empty
        ? "DRAFT"
        : "IN_PROGRESS";
    const answersJson = answers as Prisma.InputJsonValue;
    const saved = existing
      ? await prisma.collaudo.update({
          where: { machineId: id },
          data: { status: nextStatus, answers: answersJson },
        })
      : await prisma.collaudo.create({
          data: { machineId: id, status: nextStatus, answers: answersJson },
        });
    return NextResponse.json({ ok: true, status: saved.status });
  }

  if (action === "approve") {
    if (!(await userCan(user.role, "machine.sign"))) {
      return NextResponse.json({ error: "Permesso negato per approvare" }, { status: 403 });
    }
    if (!existing || existing.status !== "PENDING_APPROVAL") {
      return NextResponse.json({ error: "Collaudo non in attesa di approvazione" }, { status: 400 });
    }
    if (existing.compilerId === user.id) {
      return NextResponse.json(
        { error: "Il compilatore non può approvare il proprio collaudo" },
        { status: 400 }
      );
    }
    const signature =
      typeof body.approverSignature === "string" && body.approverSignature.startsWith("data:image")
        ? body.approverSignature
        : user.signatureImage || null;
    if (!signature)
      return NextResponse.json(
        { error: "Firma approvatore mancante. Imposta la firma personale o disegnala ora." },
        { status: 400 }
      );

    const saveSig = body.saveSignature === true && typeof body.approverSignature === "string";
    if (saveSig) {
      await prisma.user.update({
        where: { id: user.id },
        data: { signatureImage: body.approverSignature },
      });
    }

    const remarks = typeof body.remarks === "string" ? body.remarks.slice(0, 2000) : null;
    await prisma.collaudo.update({
      where: { machineId: id },
      data: {
        status: "APPROVED",
        approverId: user.id,
        approverName: user.name,
        approvedAt: new Date(),
        approverSignature: signature,
        approverRemarks: remarks,
      },
    });

    await prisma.diaryEvent.create({
      data: {
        machineId: id,
        phase: "TESTING",
        type: "milestone",
        title: "Verbale di collaudo approvato",
        note: remarks || null,
        actorName: user.name,
        authorId: user.id,
      },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Azione non riconosciuta" }, { status: 400 });
}
