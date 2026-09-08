import { NextResponse } from "next/server";
import { currentUser, verifyPin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveDataUrl } from "@/lib/uploads";
import { canValidatePos, hasPosDocument } from "@/lib/pos";

/**
 * Validazione del P.O.S. (Piano Operativo di Sicurezza) di un intervento.
 *
 * POST   → il responsabile mette il flag e firma: l'intervento esce da
 *          "Documentazione da validare" e diventa assegnabile/pianificabile.
 * DELETE → revoca la validazione: l'intervento torna in "Documentazione da
 *          validare" (se non è già partito) e si blocca di nuovo.
 *
 * Autorizzati: gli utenti con `posValidator` in anagrafica (es. Fausto Zanotti)
 * e gli amministratori.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!canValidatePos(user))
    return NextResponse.json(
      { error: "Solo il responsabile abilitato può validare il P.O.S." },
      { status: 403 }
    );

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: { id: true, code: true, status: true, posValidated: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Body non valido" }, { status: 400 });

  if (b.confirmed !== true)
    return NextResponse.json(
      { error: "Spunta la conferma di presa visione del P.O.S." },
      { status: 400 }
    );

  if (!(await hasPosDocument(id)))
    return NextResponse.json(
      { error: "Nessun P.O.S. caricato: carica prima il documento." },
      { status: 409 }
    );

  // Firma: a penna (dataURL dal canvas) oppure con il PIN personale.
  const signature = typeof b.signature === "string" ? b.signature : "";
  const pin = typeof b.pin === "string" ? b.pin.trim() : "";
  let signaturePath: string | null = null;
  if (signature.startsWith("data:image")) {
    signaturePath = await saveDataUrl(signature, `service/${intervento.code}/pos`, "sig-pos");
  } else if (pin) {
    if (!user.pinHash)
      return NextResponse.json({ error: "Nessun PIN impostato per questo utente" }, { status: 400 });
    if (!(await verifyPin(pin, user.pinHash)))
      return NextResponse.json({ error: "PIN errato" }, { status: 401 });
    // se l'utente ha una firma personale salvata, la si archivia come firma del P.O.S.
    signaturePath = user.signatureImage?.startsWith("data:image")
      ? await saveDataUrl(user.signatureImage, `service/${intervento.code}/pos`, "sig-pos")
      : user.signatureImage?.startsWith("/uploads/")
        ? user.signatureImage
        : null;
  } else {
    return NextResponse.json(
      { error: "Firma obbligatoria: firma a penna oppure inserisci il PIN." },
      { status: 400 }
    );
  }

  const now = new Date();
  const updated = await prisma.intervento.update({
    where: { id },
    data: {
      posValidated: true,
      posValidatedAt: now,
      posValidatedById: user.id,
      posValidatedByName: user.name,
      posSignature: signaturePath,
      posNote: typeof b.note === "string" ? b.note.trim() || null : null,
      // sbloccato: entra nel flusso normale
      ...(intervento.status === "DOCUMENTAZIONE" ? { status: "NUOVO" as const } : {}),
    },
    select: { status: true, posValidatedAt: true },
  });

  return NextResponse.json({
    ok: true,
    status: updated.status,
    validatedAt: updated.posValidatedAt?.toISOString() ?? null,
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!canValidatePos(user))
    return NextResponse.json(
      { error: "Solo il responsabile abilitato può revocare la validazione del P.O.S." },
      { status: 403 }
    );

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  // Un intervento già partito (o chiuso) non si riporta indietro di stato:
  // la validazione decade ma lo storico resta com'è.
  const backToDoc = intervento.status === "NUOVO" || intervento.status === "PIANIFICATO";

  await prisma.intervento.update({
    where: { id },
    data: {
      posValidated: false,
      posValidatedAt: null,
      posValidatedById: null,
      posValidatedByName: null,
      posSignature: null,
      posNote: null,
      ...(backToDoc ? { status: "DOCUMENTAZIONE" as const } : {}),
    },
  });

  return NextResponse.json({ ok: true, reverted: backToDoc });
}
