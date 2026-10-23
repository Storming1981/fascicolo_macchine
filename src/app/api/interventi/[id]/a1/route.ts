import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/uploads";
import { A1_CATEGORY } from "@/lib/domain";
import { loadInterventoBrief, buildA1UploadedNotices } from "@/lib/interventoNotify";
import { createNotifications } from "@/lib/notifications";
import { deliverNotifications } from "@/lib/notifyDeliver";
import { absoluteUrl } from "@/lib/absoluteUrl";

/**
 * Documenti **A1** di un intervento: i certificati richiesti per la presenza
 * dei nostri tecnici in cantiere, uno per tecnico.
 *
 * Ha una rotta sua, separata dagli altri allegati, per una ragione precisa:
 * chi li carica è un profilo **in sola lettura** (data entry), e `src/proxy.ts`
 * apre le scritture **per path**, senza poter guardare dentro al corpo della
 * richiesta. Con la rotta generica dei documenti si sarebbe dovuto aprire tutto
 * l'allegato per fidarsi poi del controllo della singola route — esattamente
 * ciò che il proxy esiste per non dover fare.
 *
 * Chi può: chi ha il flag `User.a1Manager` in anagrafica (per **tutti** gli
 * interventi, come il validatore del P.O.S.) e chi gestisce gli interventi.
 */
async function canHandleA1(user: { id: string; role: string; a1Manager: boolean }) {
  if (user.a1Manager) return true;
  return userCan(user.role as Parameters<typeof userCan>[0], "intervento.edit");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await canHandleA1(user)))
    return NextResponse.json(
      { error: "Solo chi gestisce i documenti A1 può caricarli." },
      { status: 403 }
    );

  const { id } = await ctx.params;
  const intervento = await prisma.intervento.findUnique({
    where: { id },
    select: { id: true, code: true, createdById: true },
  });
  if (!intervento) return NextResponse.json({ error: "Intervento non trovato" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "Nessun file" }, { status: 400 });
  // Tecnico a cui il documento si riferisce (facoltativo): un A1 è di una
  // persona, non del cantiere.
  const userId = String(form.get("userId") || "").trim() || null;

  const before = await prisma.interventoDocument.count({
    where: { interventoId: id, category: A1_CATEGORY },
  });

  const scope = `service/${intervento.code}/documenti`;
  const created: { id: string; name: string }[] = [];
  for (const f of files) {
    const saved = await saveFile(f, scope);
    const rec = await prisma.interventoDocument.create({
      data: {
        interventoId: id,
        name: f.name || "documento",
        path: saved.path,
        mimeType: f.type || null,
        sizeBytes: saved.size,
        category: A1_CATEGORY,
        source: "UPLOAD",
        userId,
        uploadedById: user.id,
        uploadedByName: user.name,
      },
    });
    created.push({ id: rec.id, name: rec.name });
  }

  // ── Primi A1 arrivati: torna a chi ha aperto l'intervento ──────────
  // Solo la prima volta: un avviso per ogni certificato di una cartella che si
  // riempie un tecnico alla volta sarebbe rumore sulla campanella.
  if (created.length && before === 0) {
    try {
      const brief = await loadInterventoBrief(id);
      if (brief) {
        const notices = await buildA1UploadedNotices(
          brief,
          intervento.createdById,
          { id: user.id, name: user.name },
          created.length
        );
        if (notices.length) {
          const ids = await createNotifications(notices.map((n) => n.notification));
          const base = absoluteUrl(req, "");
          after(async () => {
            await deliverNotifications(ids, notices, user.id, base);
          });
        }
      }
    } catch (e) {
      // I file sono già salvati: un avviso mancato non li annulla.
      console.error("[notifiche] caricamento A1", id, e);
    }
  }

  return NextResponse.json({ ok: true, count: created.length });
}

/** Toglie un documento A1 (file sbagliato, tecnico cambiato). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await canHandleA1(user)))
    return NextResponse.json(
      { error: "Solo chi gestisce i documenti A1 può eliminarli." },
      { status: 403 }
    );

  const { id } = await ctx.params;
  const docId = new URL(req.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId mancante" }, { status: 400 });

  const doc = await prisma.interventoDocument.findFirst({
    where: { id: docId, interventoId: id, category: A1_CATEGORY },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });

  await prisma.interventoDocument.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
