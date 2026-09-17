import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/uploads";
import { indexSource } from "@/lib/brain/indexer";
import { isSupportedDocument } from "@/lib/brain/extract";
import { maxBytesFor } from "@/lib/brain/config";
import type { KnowledgeSourceType, KnowledgeVisibility, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const TYPES: KnowledgeSourceType[] = [
  "MANUAL",
  "PROCEDURE",
  "CASE",
  "DRAWING",
  "VIDEO",
  "BULLETIN",
  "SPARE",
  "ARTICLE",
  "OTHER",
];

/** Elenco delle fonti indicizzate, con i filtri della pagina Knowledge. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.view")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const plantType = url.searchParams.get("plantType");
  const q = url.searchParams.get("q")?.trim();

  const where: Prisma.KnowledgeSourceWhereInput = {};
  if (type && TYPES.includes(type as KnowledgeSourceType)) where.type = type as KnowledgeSourceType;
  else if (type === "__derived") where.type = { in: ["RAPPORTINO", "CHAT", "DIARY", "ARTICLE"] };
  if (plantType) where.plantType = plantType;
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { tags: { has: q } }];

  const sources = await prisma.knowledgeSource.findMany({
    where,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 300,
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      status: true,
      error: true,
      visibility: true,
      filePath: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      pageCount: true,
      videoUrl: true,
      plantType: true,
      model: true,
      tags: true,
      chunkCount: true,
      tokensEstimate: true,
      ocrUsed: true,
      indexedAt: true,
      uploadedByName: true,
      originKind: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const stats = await prisma.knowledgeSource.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { chunkCount: true },
  });

  return NextResponse.json({ sources, stats });
}

/**
 * Carica una nuova fonte e la indicizza subito.
 *
 * multipart/form-data: `file` (PDF/Word/immagine/testo) oppure `videoUrl`/`text`
 * per le fonti senza allegato.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  // Due modi di creare una fonte:
  //  - multipart, per i documenti: il file viaggia insieme ai metadati;
  //  - JSON con `awaitingFile`, per i file grossi (video): qui si salvano solo
  //    i metadati e il file arriva dopo, in streaming, su PUT …/[id]/file.
  //    `req.formData()` tiene tutto in memoria e su mezzo giga non regge.
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const json = isJson ? ((await req.json().catch(() => null)) as Record<string, unknown> | null) : null;
  const form = isJson ? null : await req.formData().catch(() => null);
  if (!json && !form) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });

  const str = (k: string) => {
    const v = json ? json[k] : form!.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const awaitingFile = json ? json.awaitingFile === true : false;

  const rawType = str("type") ?? "MANUAL";
  const type = (TYPES.includes(rawType as KnowledgeSourceType) ? rawType : "OTHER") as KnowledgeSourceType;
  const file = form?.get("file") ?? null;
  const videoUrl = str("videoUrl");
  const description = str("description");
  let title = str("title");

  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !awaitingFile && !videoUrl && !description)
    return NextResponse.json(
      { error: "Serve un file, un link video oppure del testo da indicizzare" },
      { status: 400 }
    );

  let filePath: string | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let sizeBytes: number | null = null;

  if (hasFile) {
    if (file.size > maxBytesFor(type))
      return NextResponse.json(
        { error: `File troppo grande (massimo ${Math.round(maxBytesFor(type) / 1024 / 1024)} MB)` },
        { status: 413 }
      );
    if (type !== "VIDEO" && !isSupportedDocument(file.type, file.name))
      return NextResponse.json(
        { error: "Formato non supportato: usa PDF, Word (.docx), testo o immagini" },
        { status: 415 }
      );
    const saved = await saveFile(file, "knowledge");
    filePath = saved.path;
    fileName = file.name;
    mimeType = file.type || "application/octet-stream";
    sizeBytes = saved.size;
    if (!title) title = file.name.replace(/\.[^.]+$/, "");
  }

  if (!title) return NextResponse.json({ error: "Titolo obbligatorio" }, { status: 400 });


  const source = await prisma.knowledgeSource.create({
    data: {
      type,
      title,
      description,
      filePath,
      fileName,
      mimeType,
      sizeBytes,
      videoUrl,
      visibility: (str("visibility") === "CUSTOMER" ? "CUSTOMER" : "INTERNAL") as KnowledgeVisibility,
      plantType: str("plantType"),
      model: str("model"),
      machineId: str("machineId"),
      customerId: str("customerId"),
      tags: (str("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12),
      uploadedById: user.id,
      uploadedByName: user.name,
    },
  });

  // L'indicizzazione NON sta dentro la richiesta: un manuale scansionato di 105
  // pagine richiede una decina di minuti di OCR, e il proxy chiude la
  // connessione molto prima. Il risultato era il peggiore possibile — l'utente
  // vedeva un 504 mentre il lavoro finiva bene in silenzio. Si risponde subito,
  // il documento resta "In lavorazione" e la lista si aggiorna da sola.
  // Se il file deve ancora arrivare non c'è niente da indicizzare: ci pensa
  // PUT …/[id]/file quando lo stream è finito.
  if (!awaitingFile)
    after(async () => {
      try {
        await indexSource(source.id, { force: true });
      } catch {
        // indexSource marca già la sorgente come FAILED con il motivo.
      }
    });

  return NextResponse.json({ ok: true, id: source.id, queued: !awaitingFile, awaitingFile });
}
