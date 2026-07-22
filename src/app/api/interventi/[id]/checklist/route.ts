import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveDataUrl, saveBytes, sha256, readUploadAsDataUrl } from "@/lib/uploads";
import { CHECKLIST_DEFS, type ChecklistType } from "@/lib/checklistInterventi";
import { generateChecklistPdf } from "@/lib/checklistPdf";
import type { Prisma } from "@prisma/client";

const TYPES: ChecklistType[] = ["AMBIENTE_SICUREZZA"];

/**
 * Salva (bozza) o CHIUDE (firma + data → PDF) una check list di cantiere di un
 * intervento. Solo chi ha `checklist.manage` (Amministratore / Responsabile
 * cantieri) può compilarle.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "checklist.manage")))
    return NextResponse.json({ error: "Solo il Responsabile cantieri può compilare le check list" }, { status: 403 });

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, city: true, province: true, country: true } },
      site: { select: { name: true, address: true, city: true, province: true } },
    },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const b = await req.json().catch(() => null);
  const type = String(b?.type || "") as ChecklistType;
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Tipo non valido" }, { status: 400 });
  const def = CHECKLIST_DEFS[type];

  const answers: Record<string, string> = {};
  if (b?.answers && typeof b.answers === "object") {
    for (const [k, v] of Object.entries(b.answers)) {
      if (v === "SI" || v === "NO" || v === "NA") answers[k] = v;
    }
  }
  const fields: Record<string, string> = {};
  if (b?.fields && typeof b.fields === "object") {
    for (const [k, v] of Object.entries(b.fields)) fields[k] = String(v ?? "");
  }
  const finalize = b?.finalize === true || b?.finalize === "1";
  const clientName = typeof b?.clientName === "string" ? b.clientName.trim() || null : null;
  const compilerSig = String(b?.compilerSignature || "");
  const clientSig = String(b?.clientSignature || "");
  const editNote = typeof b?.editNote === "string" ? b.editNote.trim() || null : null;

  const existing = await prisma.interventoChecklist.findUnique({
    where: { interventoId_type: { interventoId: id, type } },
  });
  // Una check list chiusa può essere CORRETTA (riaperta, modificata, ristampata),
  // tenendo traccia delle correzioni.
  const wasClosed = existing?.closed === true;

  const scope = intervento.machineId ? `service/${intervento.code}/checklist` : `service/${intervento.code}/checklist`;

  let compilerSigPath = existing?.compilerSignature ?? null;
  if (compilerSig.startsWith("data:image")) compilerSigPath = await saveDataUrl(compilerSig, scope, "sig-resp");
  let clientSigPath = existing?.clientSignature ?? null;
  if (clientSig.startsWith("data:image")) clientSigPath = await saveDataUrl(clientSig, scope, "sig-cli");

  const data = {
    interventoId: id,
    type,
    answers,
    fields,
    compilerName: user.name,
    compilerId: user.id,
    compilerSignature: compilerSigPath,
    clientName,
    clientSignature: clientSigPath,
  };

  if (!finalize) {
    const saved = await prisma.interventoChecklist.upsert({
      where: { interventoId_type: { interventoId: id, type } },
      update: data,
      create: data,
    });
    return NextResponse.json({ ok: true, finalized: false, id: saved.id });
  }

  // Chiusura / ristampa: firma responsabile obbligatoria → PDF
  if (!compilerSigPath)
    return NextResponse.json({ error: "La firma del responsabile è obbligatoria per chiudere." }, { status: 400 });

  const now = new Date();
  const hash = sha256(`${id}|${type}|${user.name}|${now.toISOString()}`);

  // Testata autocompilata: indirizzo dall'anagrafica cantiere/cliente e date
  // dalle date pianificate dell'intervento.
  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("it-IT") : "—");
  const addr =
    [intervento.site?.address, [intervento.site?.city, intervento.site?.province].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(" - ") ||
    [intervento.customer?.city, intervento.customer?.province, intervento.customer?.country]
      .filter(Boolean)
      .join(" ") ||
    "—";
  // Solo le date sotto la testata (ditta/indirizzo sono già nella riga cliente).
  const autoHeader =
    type === "AMBIENTE_SICUREZZA"
      ? [
          { label: "Data inizio intervento", value: fmtDate(intervento.scheduledStart) },
          { label: "Data fine intervento", value: fmtDate(intervento.scheduledEnd) },
        ]
      : [];

  // firme per il PDF: quella nuova se rifirmata, altrimenti si reincorpora la salvata
  const compilerSigForPdf = compilerSig.startsWith("data:image")
    ? compilerSig
    : await readUploadAsDataUrl(compilerSigPath);
  const clientSigForPdf = clientSig.startsWith("data:image")
    ? clientSig
    : await readUploadAsDataUrl(clientSigPath);

  const pdfBytes = await generateChecklistPdf({
    def,
    interventoCode: intervento.code,
    interventoTitle: intervento.title,
    customer: intervento.customer?.name ?? null,
    site: intervento.site?.name ?? null,
    address: addr !== "—" ? addr : null,
    answers,
    fields,
    autoHeader,
    compilerName: user.name,
    compilerSigDataUrl: compilerSigForPdf,
    clientName,
    clientSigDataUrl: clientSigForPdf,
    compiledAt: now,
    hash,
  });
  const pdfPath = await saveBytes(pdfBytes, scope, `checklist-${type.toLowerCase()}-${Date.now()}.pdf`);

  // Log correzione se era già chiusa
  const prevRevisions = Array.isArray(existing?.revisions) ? (existing!.revisions as unknown[]) : [];
  const revisions = (wasClosed
    ? [...prevRevisions, { at: now.toISOString(), byName: user.name, note: editNote }]
    : prevRevisions) as Prisma.InputJsonValue;

  const saved = await prisma.interventoChecklist.upsert({
    where: { interventoId_type: { interventoId: id, type } },
    update: { ...data, closed: true, compiledAt: now, hash, pdfPath, revisions },
    create: { ...data, closed: true, compiledAt: now, hash, pdfPath, revisions },
  });

  return NextResponse.json({ ok: true, finalized: true, id: saved.id, pdfPath, corrected: wasClosed });
}
