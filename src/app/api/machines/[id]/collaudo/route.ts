import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { checklistFor, type ChecklistItem } from "@/lib/checklist";
import { externalSignerLabel } from "@/lib/externalSigners";
import { isExternalTester } from "@/lib/permissions";
import { hasCollaudo } from "@/lib/plant";
import type { Prisma, CollaudoStatus } from "@prisma/client";

type Answer = { value: "SI" | "NO" | "NA" | null; note?: string };
type AnswersMap = Record<string, Answer>;

function sanitizeAnswers(raw: unknown, items: ChecklistItem[]): AnswersMap {
  const out: AnswersMap = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, { value?: unknown; note?: unknown }>;
  for (const item of items) {
    const k = String(item.n);
    const a = r[k];
    if (!a) continue;
    const v = a.value === "SI" || a.value === "NO" || a.value === "NA" ? a.value : null;
    const n = typeof a.note === "string" ? a.note.slice(0, 1000) : "";
    if (v || n) out[k] = { value: v, note: n };
  }
  return out;
}

function allAnswered(answers: AnswersMap, items: ChecklistItem[]): boolean {
  return items.every((it) => {
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

  if (!hasCollaudo(machine.plantType))
    return NextResponse.json(
      { error: "Per questa tipologia impianto non è prevista la check list di collaudo" },
      { status: 400 }
    );

  const body = await req.json();
  const action = String(body.action || "save");
  // cesoie e spaccabinari: M5.7 al posto della M7.3 dei trituratori
  const items = checklistFor(machine.plantType).items;

  const existing = await prisma.collaudo.findUnique({ where: { machineId: id } });

  if (action === "save" || action === "submit") {
    if (!isExternalTester(user.role) && !(await userCan(user.role, "machine.intervention"))) {
      return NextResponse.json({ error: "Permesso negato per compilare il collaudo" }, { status: 403 });
    }
    const answers = sanitizeAnswers(body.answers, items);
    const empty = Object.keys(answers).length === 0;
    // la versione software la scrive solo chi compila la check list
    const softwareVersion =
      typeof body.softwareVersion === "string" ? body.softwareVersion.trim().slice(0, 80) || null : undefined;

    if (action === "submit") {
      if (!allAnswered(answers, items))
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
        ...(softwareVersion !== undefined ? { softwareVersion } : {}),
        compilerId: user.id,
        // l'esterno compare con la ditta: "Elia Presti (St.el)"
        compilerName: user.company ? `${user.name} (${user.company})` : user.name,
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
          data: { status: nextStatus, answers: answersJson, ...(softwareVersion !== undefined ? { softwareVersion } : {}) },
        })
      : await prisma.collaudo.create({
          data: { machineId: id, status: nextStatus, answers: answersJson, ...(softwareVersion !== undefined ? { softwareVersion } : {}) },
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

    // Approvazione firmata da una persona esterna senza account (cliente,
    // ente certificatore...): la firma si disegna sul dispositivo di chi la
    // raccoglie. Il compilatore puo' raccoglierla: non e' lui ad approvare.
    if (typeof body.externalSignerId === "string" && body.externalSignerId) {
      const ext = await prisma.externalSigner.findUnique({ where: { id: body.externalSignerId } });
      if (!ext || !ext.active)
        return NextResponse.json({ error: "Persona esterna non trovata o disattivata" }, { status: 400 });
      const sig =
        typeof body.approverSignature === "string" && body.approverSignature.startsWith("data:image")
          ? body.approverSignature
          : null;
      if (!sig)
        return NextResponse.json({ error: "Manca la firma della persona esterna" }, { status: 400 });
      const name = externalSignerLabel(ext);
      const remarks = typeof body.remarks === "string" ? body.remarks.slice(0, 2000) : null;
      await prisma.collaudo.update({
        where: { machineId: id },
        data: {
          status: "APPROVED",
          approverId: null,
          approverName: name,
          approverExternalId: ext.id,
          approvalCollectedById: user.id,
          approvalCollectedByName: user.name,
          approvedAt: new Date(),
          approverSignature: sig,
          approverRemarks: remarks,
        },
      });
      await prisma.diaryEvent.create({
        data: {
          machineId: id,
          phase: "TESTING",
          type: "milestone",
          title: "Verbale di collaudo approvato",
          note:
            `Firma esterna: ${name}${ext.jobTitle ? ` · ${ext.jobTitle}` : ""}. Firma raccolta da ${user.name}.` +
            (remarks ? `\n${remarks}` : ""),
          actorName: name,
          authorId: user.id,
        },
      });
      return NextResponse.json({ ok: true });
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
        approverExternalId: null,
        approvalCollectedById: null,
        approvalCollectedByName: null,
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
