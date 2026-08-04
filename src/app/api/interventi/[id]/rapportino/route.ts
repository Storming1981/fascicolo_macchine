import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile, saveDataUrl, saveBytes, sha256 } from "@/lib/uploads";
import { renderRapportinoPdf } from "@/lib/rapportinoRender";
import { isFeedConfigured, fetchOpenSessionsForCommessa } from "@/lib/presenceFeed";

const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

type RicambioLine = { code: string; desc: string; qty: string; note: string };
type OperatorLine = { name: string; matricola: string | null; hours: number };
type TimbraturaLine = { name: string; start: string; end: string; orig?: { name: string; start: string; end: string } };

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

/** (Ri)genera il PDF del rapportino e ne salva una copia archiviata (pdfPath). */
async function regenRapportinoPdf(rapportinoId: string, scope: string): Promise<string | null> {
  try {
    const out = await renderRapportinoPdf(rapportinoId);
    if (!out) return null;
    const pdfPath = await saveBytes(out.bytes, scope, `rapportino-${rapportinoId}.pdf`);
    await prisma.rapportino.update({ where: { id: rapportinoId }, data: { pdfPath } });
    return pdfPath;
  } catch {
    return null; // la mancata generazione PDF non deve bloccare la chiusura
  }
}

/** Righe ore per operatore: [{ name, matricola?, hours }]. */
function parseOperators(raw: string): OperatorLine[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r) => {
        const h = Number(String(r.hours ?? "").replace(",", "."));
        return {
          name: String(r.name ?? "").trim(),
          matricola: r.matricola != null ? String(r.matricola).trim() || null : null,
          hours: Number.isFinite(h) ? Math.round(h * 100) / 100 : 0,
        };
      })
      .filter((r) => r.name || r.hours > 0);
  } catch {
    return [];
  }
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
/** Righe timbrature: [{ name, start:"HH:MM", end:"HH:MM" }]. */
function parseTimbrature(raw: string): TimbraturaLine[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r) => {
        const row: TimbraturaLine = {
          name: String(r.name ?? "").trim(),
          start: HHMM.test(String(r.start ?? "")) ? String(r.start) : "",
          end: HHMM.test(String(r.end ?? "")) ? String(r.end) : "",
        };
        // preserva la timbratura originale del timbratore (per evidenziare le modifiche)
        const o = r.orig;
        if (o && (o.name != null || o.start != null || o.end != null))
          row.orig = { name: String(o.name ?? ""), start: String(o.start ?? ""), end: String(o.end ?? "") };
        return row;
      })
      .filter((r) => r.name || r.start || r.end);
  } catch {
    return [];
  }
}

const toMin = (hhmm: string): number | null => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Da timbrature calcola totale e aggregato per operatore. */
function hoursFromTimbrature(rows: TimbraturaLine[]): { total: number; byOperator: OperatorLine[] } {
  const byName = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const s = toMin(r.start);
    const e = toMin(r.end);
    const h = s != null && e != null && e > s ? Math.round(((e - s) / 60) * 100) / 100 : 0;
    total += h;
    const key = r.name || "—";
    byName.set(key, Math.round(((byName.get(key) ?? 0) + h) * 100) / 100);
  }
  return {
    total: Math.round(total * 100) / 100,
    byOperator: [...byName.entries()].map(([name, hours]) => ({ name, matricola: null, hours })),
  };
}

type SavedAtt = { id: string; path: string; kind: string };
/** Salva i file del campo multipart `attachments` come RapportinoAttachment. */
async function saveAttachments(
  rapportinoId: string,
  form: FormData,
  uploadedByName: string,
  scope: string
): Promise<SavedAtt[]> {
  const files = form.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  const out: SavedAtt[] = [];
  for (const f of files) {
    const saved = await saveFile(f, scope);
    const kind = (f.type || "").startsWith("image/") ? "image" : "file";
    const rec = await prisma.rapportinoAttachment.create({
      data: {
        rapportinoId,
        path: saved.path,
        filename: f.name || "allegato",
        mime: f.type || "application/octet-stream",
        size: saved.size,
        kind,
        uploadedByName,
      },
    });
    out.push({ id: rec.id, path: rec.path, kind: rec.kind });
  }
  return out;
}

/** Rispecchia gli allegati immagine nel diario del fascicolo (una Photo per foto). */
async function mirrorImagesToDiary(
  atts: SavedAtt[],
  args: { interventoId: string; machineId: string | null; diaryEventId: string; caption: string; authorName: string; authorId: string }
) {
  for (const a of atts) {
    if (a.kind !== "image") continue;
    await prisma.photo.create({
      data: {
        interventoId: args.interventoId,
        machineId: args.machineId,
        diaryEventId: args.diaryEventId,
        path: a.path,
        category: "intervento",
        caption: args.caption,
        authorName: args.authorName,
        authorId: args.authorId,
      },
    });
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
  // problematiche / mancanze rilevate in cantiere nella giornata
  const issues = String(form.get("issues") || "").trim() || null;
  const ricambi = parseRicambi(String(form.get("ricambi") || "[]"));
  const timbrature = parseTimbrature(String(form.get("timbrature") || "[]"));
  const operatorsLegacy = parseOperators(String(form.get("hoursByOperator") || "[]"));
  const hoursRaw = String(form.get("hoursWorked") || "").trim();
  // Ore/aggregato derivati dalle timbrature (entrata/uscita); fallback: righe
  // operatore legacy, poi campo singolo.
  let operators: OperatorLine[];
  let hoursWorked: number | null;
  if (timbrature.length) {
    const agg = hoursFromTimbrature(timbrature);
    operators = agg.byOperator;
    hoursWorked = agg.total;
  } else if (operatorsLegacy.length) {
    operators = operatorsLegacy;
    hoursWorked = Math.round(operatorsLegacy.reduce((n, o) => n + o.hours, 0) * 100) / 100;
  } else {
    operators = [];
    hoursWorked = hoursRaw ? Number(hoursRaw.replace(",", ".")) : null;
  }
  // Ore operative dell'impianto (contaore macchina) dichiarate dal tecnico
  const plantRaw = String(form.get("plantHours") || "").trim();
  const plantParsed = plantRaw ? Number(plantRaw.replace(",", ".")) : null;
  const plantHours = plantParsed != null && !Number.isNaN(plantParsed) ? plantParsed : null;
  const techName = String(form.get("techName") || user.name).trim();
  const clientName = String(form.get("clientName") || "").trim() || null;
  const techSigData = String(form.get("techSignature") || "");
  const clientSigData = String(form.get("clientSignature") || "");
  const finalize = String(form.get("finalize") || "") === "1";
  // "Chiudi comunque": salta il blocco per timbrature ancora aperte
  const forceClose = String(form.get("forceClose") || "") === "1";

  const editNote = String(form.get("editNote") || "").trim() || null;
  let existing = null;
  if (rapportinoId) {
    existing = await prisma.rapportino.findFirst({ where: { id: rapportinoId, interventoId: id } });
    if (!existing) return NextResponse.json({ error: "Rapportino non trovato" }, { status: 404 });
    // Solo l'autore del rapportino (o un ADMIN) può modificarlo. I rapportini
    // storici senza autore restano modificabili come prima (grazia).
    if (existing.authorId && existing.authorId !== user.id && user.role !== "ADMIN")
      return NextResponse.json(
        { error: "Solo chi ha compilato il rapportino (o un amministratore) può modificarlo." },
        { status: 403 },
      );
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
    issues,
    ricambi,
    hoursWorked: hoursWorked != null && !Number.isNaN(hoursWorked) ? hoursWorked : null,
    plantHours,
    hoursByOperator: operators,
    timbrature,
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
          issues: existing.issues,
          ricambi: existing.ricambi,
          hoursWorked: existing.hoursWorked,
          plantHours: existing.plantHours,
          hoursByOperator: existing.hoursByOperator,
          timbrature: existing.timbrature,
          techName: existing.techName,
          clientName: existing.clientName,
        },
      },
    });
  }

  const rapportino = existing
    ? await prisma.rapportino.update({ where: { id: existing.id }, data: fields })
    : await prisma.rapportino.create({ data: { interventoId: id, ...fields, authorId: user.id } });

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
    // nuovi allegati; le immagini vanno anche nel diario del fascicolo
    const atts = await saveAttachments(existing.id, form, techName, scope);
    if (existing.diaryEventId)
      await mirrorImagesToDiary(atts, {
        interventoId: id,
        machineId: intervento.machine?.id ?? null,
        diaryEventId: existing.diaryEventId,
        caption: intervento.title,
        authorName: techName,
        authorId: user.id,
      });
    // rapportino firmato modificato → rigenera il PDF archiviato
    const pdfPath = await regenRapportinoPdf(rapportino.id, scope);
    return NextResponse.json({ ok: true, edited: true, rapportinoId: rapportino.id, pdfPath });
  }

  // Allegati (foto/file) del rapportino
  await saveAttachments(rapportino.id, form, techName, scope);

  if (!finalize) return NextResponse.json({ ok: true, finalized: false, rapportinoId: rapportino.id });

  // --- Blocco chiusura: operatori ancora timbrati per la commessa in quel giorno ---
  // Il rapportino è già stato salvato sopra: se blocchiamo, resta in BOZZA.
  if (!forceClose && intervento.commessa && isFeedConfigured()) {
    try {
      const openSessions = await fetchOpenSessionsForCommessa(intervento.commessa);
      const dayKey = isoDay(date);
      const stillIn = openSessions.filter((o) => isoDay(o.startedAt ?? now) === dayKey);
      if (stillIn.length > 0) {
        return NextResponse.json({
          ok: true,
          finalized: false,
          blockedByOpenSessions: true,
          openTechs: stillIn.map((o) => o.tech).filter(Boolean),
          rapportinoId: rapportino.id,
        });
      }
    } catch {
      // timbratore non raggiungibile → non blocchiamo la chiusura
    }
  }

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

    // rispecchia nel diario tutte le foto allegate al rapportino
    const imgs = await prisma.rapportinoAttachment.findMany({
      where: { rapportinoId: rapportino.id, kind: "image" },
      select: { id: true, path: true, kind: true },
    });
    await mirrorImagesToDiary(imgs, {
      interventoId: id,
      machineId: intervento.machine.id,
      diaryEventId: event.id,
      caption: intervento.title,
      authorName: techName,
      authorId: user.id,
    });
  }

  await prisma.rapportino.update({ where: { id: rapportino.id }, data: { closed: true, hash, diaryEventId } });

  // PDF archiviato del rapportino firmato
  const pdfPath = await regenRapportinoPdf(rapportino.id, scope);

  return NextResponse.json({
    ok: true,
    finalized: true,
    rapportinoId: rapportino.id,
    linkedToMachine: !!intervento.machine?.id,
    pdfPath,
  });
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
  if (r.authorId && r.authorId !== user.id && user.role !== "ADMIN")
    return NextResponse.json(
      { error: "Solo chi ha compilato il rapportino (o un amministratore) può eliminarlo." },
      { status: 403 },
    );
  await prisma.rapportino.delete({ where: { id: rapportinoId } });
  return NextResponse.json({ ok: true });
}
