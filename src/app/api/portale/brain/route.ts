import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentClient } from "@/lib/portalAuth";
import { askBrain, titleFor, type AskEvent, type UsedSource } from "@/lib/brain/ask";
import { isBrainConfigured } from "@/lib/brain/config";
import { lookupAnswer, storeAnswer } from "@/lib/brain/answerCache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * ZATO Brain per il PORTALE CLIENTE.
 *
 * Stessa pipeline di quello interno, ma con l'ambito ristretto: il retrieval
 * vede solo le fonti marcate CUSTOMER e quelle non riservate ad altri clienti,
 * e il system prompt vieta di citare informazioni interne. Rapportini e chat di
 * cantiere restano INTERNAL, quindi non arrivano mai qui.
 */
export async function POST(req: Request) {
  const client = await currentClient();
  if (!client) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!isBrainConfigured())
    return NextResponse.json({ error: "Assistente non disponibile" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Domanda mancante" }, { status: 400 });

  let threadId: string | null = typeof body?.threadId === "string" ? body.threadId : null;
  if (threadId) {
    const owned = await prisma.brainThread.findFirst({
      where: { id: threadId, userId: client.id, scope: "portal" },
      select: { id: true },
    });
    if (!owned) threadId = null;
  }
  const thread = threadId
    ? await prisma.brainThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } })
    : await prisma.brainThread.create({
        data: {
          title: await titleFor(question),
          scope: "portal",
          userId: client.id,
          userName: client.name,
          customerId: client.customerId,
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

  await prisma.brainMessage.create({ data: { threadId: thread.id, role: "user", content: question } });

  // Il parco macchine del cliente entra nel contesto: senza, il Brain non sa
  // di quale impianto sta parlando quando la domanda è generica.
  const machines = await prisma.machine.findMany({
    where: { customerId: client.customerId },
    select: { code: true, plantType: true, model: true, year: true },
    take: 20,
  });
  const context = machines.length
    ? "Impianti del cliente: " +
      machines.map((m) => `${m.code} (${m.plantType ?? "n/d"} ${m.model ?? ""}, ${m.year})`.trim()).join("; ")
    : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AskEvent | { type: "thread"; id: string; title: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      send({ type: "thread", id: thread.id, title: thread.title });

      let answer = "";
      let sources: UsedSource[] = [];
      let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let model = "";
      let latencyMs = 0;

      // Nel portale la cache rende molto: i clienti fanno le stesse domande
      // ("ogni quanto la manutenzione", "come si accende"). La chiave include il
      // cliente, quindi nessuno vede risposte tarate su un altro parco macchine.
      const cacheScope = { audience: "portal" as const, customerId: client.customerId };

      try {
        const hit = await lookupAnswer(question, cacheScope, {
          hasHistory: history.length > 0,
          hasImages: false,
        });
        if (hit) {
          send({ type: "sources", sources: hit.sources });
          for (let i = 0; i < hit.answer.length; i += 24)
            send({ type: "text", delta: hit.answer.slice(i, i + 24) });
          send({
            type: "done",
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            costUsd: 0,
            model: hit.model ?? "cache",
            latencyMs: 0,
          });
          await prisma.brainMessage.create({
            data: {
              threadId: thread.id,
              role: "assistant",
              content: hit.answer,
              sources: hit.sources as unknown as object,
              model: hit.model,
              fromCache: true,
            },
          });
          return;
        }

        for await (const ev of askBrain({
          question,
          history,
          scope: { audience: "portal", customerId: client.customerId },
          context,
        })) {
          if (ev.type === "text") answer += ev.delta;
          else if (ev.type === "sources") sources = ev.sources;
          else if (ev.type === "done") {
            usage = ev.usage;
            model = ev.model;
            latencyMs = ev.latencyMs;
          }
          // Al cliente non serve la diagnostica interna del retrieval: passa
          // solo il testo, le fonti pubbliche e gli stati.
          if (ev.type !== "citation") send(ev);
        }

        await prisma.brainMessage.create({
          data: {
            threadId: thread.id,
            role: "assistant",
            content: answer,
            sources: sources as unknown as object,
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
          citations: [],
          model,
          usage,
          hasHistory: history.length > 0,
          hasImages: false,
        });
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
      "X-Accel-Buffering": "no",
    },
  });
}
