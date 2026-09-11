import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { askBrain, titleFor, type AskEvent, type AskImage, type UsedSource, type Citation } from "@/lib/brain/ask";
import { isBrainConfigured } from "@/lib/brain/config";
import { lookupAnswer, storeAnswer } from "@/lib/brain/answerCache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MEDIA = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type Media = (typeof MEDIA)[number];

/**
 * Domanda allo ZATO Brain, in streaming (SSE).
 *
 * La risposta arriva token per token: su una risposta tecnica lunga l'attesa a
 * schermo bianco sarebbe di parecchi secondi.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!(await userCan(user.role, "knowledge.ask")))
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  if (!isBrainConfigured())
    return NextResponse.json({ error: "ZATO Brain non configurato (ANTHROPIC_API_KEY)" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Domanda mancante" }, { status: 400 });

  const images: AskImage[] = Array.isArray(body?.images)
    ? body.images
        .slice(0, 4)
        .map((i: unknown) => {
          const img = i as { mediaType?: string; data?: string };
          if (typeof img?.data !== "string" || !img.data) return null;
          const mediaType = MEDIA.includes(img.mediaType as Media) ? (img.mediaType as Media) : "image/png";
          return { mediaType, data: img.data };
        })
        .filter(Boolean)
    : [];

  // Thread: nuovo oppure ripresa di una conversazione esistente dell'utente.
  let threadId: string | null = typeof body?.threadId === "string" ? body.threadId : null;
  if (threadId) {
    const owned = await prisma.brainThread.findFirst({
      where: { id: threadId, userId: user.id },
      select: { id: true },
    });
    if (!owned) threadId = null;
  }
  const thread = threadId
    ? await prisma.brainThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
    : await prisma.brainThread.create({
        data: {
          title: await titleFor(question),
          scope: "internal",
          userId: user.id,
          userName: user.name,
          machineId: typeof body?.machineId === "string" ? body.machineId : null,
        },
      });

  const history = (
    await prisma.brainMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { role: true, content: true },
    })
  ).map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content }));

  await prisma.brainMessage.create({
    data: { threadId: thread.id, role: "user", content: question, images: [] },
  });

  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AskEvent | { type: "thread"; id: string; title: string; messageId?: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      send({ type: "thread", id: thread.id, title: thread.title });

      let answer = "";
      let sources: UsedSource[] = [];
      const citations: Citation[] = [];
      let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let model = "";
      let latencyMs = 0;

      const cacheScope = {
        audience: "internal" as const,
        plantType: typeof body?.plantType === "string" ? body.plantType : null,
        machineId: typeof body?.machineId === "string" ? body.machineId : null,
      };

      try {
        // Domanda già posta (stessa knowledge base, stesso ambito, nessuna
        // immagine, inizio conversazione): si riusa la risposta invece di
        // ripagarla. Si riproduce lo streaming perché la UI non deve accorgersene.
        const hit = await lookupAnswer(question, cacheScope, {
          hasHistory: history.length > 0,
          hasImages: images.length > 0,
        });
        if (hit) {
          send({ type: "sources", sources: hit.sources });
          for (const c of hit.citations) send({ type: "citation", citation: c });
          for (let i = 0; i < hit.answer.length; i += 24)
            send({ type: "text", delta: hit.answer.slice(i, i + 24) });
          send({
            type: "done",
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            costUsd: 0,
            model: hit.model ?? "cache",
            latencyMs: Date.now() - started,
          });
          const saved = await prisma.brainMessage.create({
            data: {
              threadId: thread.id,
              role: "assistant",
              content: hit.answer,
              sources: hit.sources as unknown as object,
              citations: hit.citations as unknown as object,
              model: hit.model,
              fromCache: true,
            },
          });
          send({ type: "thread", id: thread.id, title: thread.title, messageId: saved.id });
          return;
        }

        for await (const ev of askBrain({
          question,
          history,
          images,
          scope: {
            audience: "internal",
            plantType: typeof body?.plantType === "string" ? body.plantType : null,
            machineId: typeof body?.machineId === "string" ? body.machineId : null,
          },
          context: typeof body?.context === "string" ? body.context : null,
        })) {
          if (ev.type === "text") answer += ev.delta;
          else if (ev.type === "sources") sources = ev.sources;
          else if (ev.type === "citation") citations.push(ev.citation);
          else if (ev.type === "done") {
            usage = ev.usage;
            model = ev.model;
            latencyMs = ev.latencyMs;
          }
          send(ev);
        }

        const saved = await prisma.brainMessage.create({
          data: {
            threadId: thread.id,
            role: "assistant",
            content: answer,
            sources: sources as unknown as object,
            citations: citations as unknown as object,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            latencyMs,
          },
        });
        await storeAnswer({
          question,
          scope: cacheScope,
          answer,
          sources,
          citations,
          model,
          usage,
          hasHistory: history.length > 0,
          hasImages: images.length > 0,
        });
        send({ type: "thread", id: thread.id, title: thread.title, messageId: saved.id });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Errore inatteso" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
