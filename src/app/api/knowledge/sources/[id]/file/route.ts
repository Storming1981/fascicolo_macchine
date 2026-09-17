import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { saveStream } from "@/lib/uploads";
import { indexSource } from "@/lib/brain/indexer";
import { maxBytesFor } from "@/lib/brain/config";
import { isSupportedDocument } from "@/lib/brain/extract";

export const dynamic = "force-dynamic";

/**
 * Carica il file di una fonte già creata, **in streaming**.
 *
 * Perché non il solito multipart: `req.formData()` tiene l'intero corpo in
 * memoria. Per un PDF va bene, per un video di procedura no — un filmato di
 * cantiere sta fra i 100 MB e il mezzo giga e farebbe esplodere il container.
 * Qui i byte vanno dalla rete al disco a blocchi, a memoria costante, e il
 * client può mostrare l'avanzamento (con `fetch` non si può: serve XHR).
 *
 * I metadati sono già stati salvati dalla POST che ha creato la fonte: qui
 * arriva solo il corpo grezzo, col nome file nell'header `x-filename`.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.manage")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });

  const { id } = await ctx.params;
  const source = await prisma.knowledgeSource.findUnique({
    where: { id },
    select: { id: true, type: true, title: true, filePath: true },
  });
  if (!source) return NextResponse.json({ error: "Fonte non trovata" }, { status: 404 });
  if (!req.body) return NextResponse.json({ error: "Nessun file ricevuto" }, { status: 400 });

  const rawName = req.headers.get("x-filename") ?? "";
  const fileName = (() => {
    try {
      return decodeURIComponent(rawName) || "allegato";
    } catch {
      return rawName || "allegato";
    }
  })();
  const mimeType = req.headers.get("content-type") || "application/octet-stream";

  // Controllo del formato: sul vecchio percorso multipart c'era, su questo si
  // era perso. Un .mp4 caricato come "Manuale macchina" finiva nell'estrattore
  // di testo, che lo leggeva come UTF-8: byte binari, e Postgres rifiutava
  // l'indice con "0x00 cannot be converted to text".
  const sembraVideo = mimeType.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm|m4v|3gp)$/i.test(fileName);
  if (source.type !== "VIDEO" && (sembraVideo || !isSupportedDocument(mimeType, fileName))) {
    await prisma.knowledgeSource.delete({ where: { id } }).catch(() => {});
    return NextResponse.json(
      {
        error: sembraVideo
          ? 'Questo è un video: scegli "Video procedura" come tipo di contenuto, non "Manuale macchina".'
          : "Formato non supportato: usa PDF, Word (.docx), testo o immagini.",
      },
      { status: 415 }
    );
  }
  if (source.type === "VIDEO" && !sembraVideo && !mimeType.startsWith("video/") && fileName !== "allegato") {
    // Non si blocca: un video può arrivare con un mime generico. Si annota.
    console.warn(`[knowledge] file non riconosciuto come video: ${fileName} (${mimeType})`);
  }

  const saved = await saveStream(req.body, "knowledge", fileName, maxBytesFor(source.type));
  if ("error" in saved) {
    // La fonte è già stata creata dalla chiamata precedente: se il file non
    // arriva, non si lascia un record fantasma nell'elenco.
    await prisma.knowledgeSource.delete({ where: { id } }).catch(() => {});
    return NextResponse.json({ error: saved.error }, { status: 413 });
  }

  await prisma.knowledgeSource.update({
    where: { id },
    data: {
      filePath: saved.path,
      fileName,
      mimeType,
      sizeBytes: saved.size,
      status: "PENDING",
      error: null,
    },
  });

  // L'indicizzazione prosegue dopo la risposta: su un manuale scansionato dura
  // minuti, e il client non deve restare appeso.
  after(async () => {
    try {
      await indexSource(id, { force: true });
    } catch {
      /* indexSource segna già FAILED con il motivo */
    }
  });

  return NextResponse.json({ ok: true, id, size: saved.size });
}
