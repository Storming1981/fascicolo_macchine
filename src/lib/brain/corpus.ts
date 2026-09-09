import { prisma } from "@/lib/db";
import { indexSource } from "./indexer";

/**
 * Il corpus vivo di ZATO.
 *
 * Manuali e procedure dicono come DOVREBBE andare; rapportini e chat di cantiere
 * dicono come è andata davvero. Qui il secondo tipo di conoscenza viene reso
 * cercabile allo stesso modo del primo, così il Brain può rispondere
 * "questo guasto è già capitato quattro volte, si è risolto così".
 *
 * Ogni contenuto derivato diventa una KnowledgeSource identificata da
 * (originKind, originId): la sincronizzazione è idempotente e rieseguibile.
 */

const MIN_CHARS = 120; // sotto questa soglia non c'è conoscenza, solo rumore

type SyncStat = { created: number; updated: number; skipped: number; indexed: number };
const empty = (): SyncStat => ({ created: 0, updated: 0, skipped: 0, indexed: 0 });

async function upsertDerived(args: {
  originKind: string;
  originId: string;
  type: "RAPPORTINO" | "CHAT" | "DIARY" | "ARTICLE";
  title: string;
  body: string;
  plantType?: string | null;
  model?: string | null;
  machineId?: string | null;
  customerId?: string | null;
  tags?: string[];
  updatedAt: Date;
  stat: SyncStat;
}): Promise<void> {
  const { originKind, originId, body, stat } = args;
  if (body.trim().length < MIN_CHARS) {
    stat.skipped++;
    return;
  }

  const existing = await prisma.knowledgeSource.findUnique({
    where: { originKind_originId: { originKind, originId } },
  });

  // Già indicizzato e la fonte non è cambiata: niente da fare.
  if (existing && existing.indexedAt && existing.indexedAt >= args.updatedAt) {
    stat.skipped++;
    return;
  }

  const data = {
    type: args.type,
    title: args.title.slice(0, 200),
    description: body,
    plantType: args.plantType ?? null,
    model: args.model ?? null,
    machineId: args.machineId ?? null,
    customerId: args.customerId ?? null,
    tags: args.tags ?? [],
    // I contenuti operativi restano interni: nel portale il cliente non deve
    // leggere i rapportini o le chat di altri cantieri.
    visibility: "INTERNAL" as const,
    status: "PENDING" as const,
  };

  const source = existing
    ? await prisma.knowledgeSource.update({ where: { id: existing.id }, data })
    : await prisma.knowledgeSource.create({ data: { ...data, originKind, originId } });

  if (existing) stat.updated++;
  else stat.created++;

  const r = await indexSource(source.id, { force: true });
  if (r.ok) stat.indexed++;
}

/* ───────────────────────── Rapportini ───────────────────────── */

type Ricambio = { code?: string; desc?: string; qty?: number | string; note?: string };

/** Rapportini di cantiere: lavorazioni svolte, problematiche, ricambi montati. */
export async function syncRapportini(limit = 500): Promise<SyncStat> {
  const stat = empty();
  const rows = await prisma.rapportino.findMany({
    where: { intervento: { deletedAt: null } },
    orderBy: { date: "desc" },
    take: limit,
    select: {
      id: true,
      date: true,
      updatedAt: true,
      workDescription: true,
      issues: true,
      ricambi: true,
      plantHours: true,
      techName: true,
      intervento: {
        select: {
          code: true,
          title: true,
          type: true,
          customerId: true,
          customer: { select: { name: true } },
          site: { select: { name: true, city: true } },
          machine: { select: { id: true, code: true, plantType: true, model: true } },
        },
      },
    },
  });

  for (const r of rows) {
    const i = r.intervento;
    const m = i.machine;
    const lines: string[] = [];
    lines.push(`Intervento ${i.code} — ${i.title} (${i.type})`);
    lines.push(
      `Data: ${r.date.toLocaleDateString("it-IT")} · Cliente: ${i.customer?.name ?? "n/d"}` +
        (i.site?.name ? ` · Cantiere: ${i.site.name}${i.site.city ? " (" + i.site.city + ")" : ""}` : "")
    );
    if (m) lines.push(`Macchina: ${m.code} · ${m.plantType ?? ""} ${m.model ?? ""}`.trim());
    if (r.plantHours != null) lines.push(`Ore impianto al momento dell'intervento: ${r.plantHours}`);
    if (r.techName) lines.push(`Tecnico: ${r.techName}`);
    if (r.workDescription?.trim()) lines.push(`\n## Lavorazioni svolte\n${r.workDescription.trim()}`);
    if (r.issues?.trim()) lines.push(`\n## Problematiche rilevate\n${r.issues.trim()}`);

    const ricambi = Array.isArray(r.ricambi) ? (r.ricambi as Ricambio[]) : [];
    const usable = ricambi.filter((x) => x && (x.code || x.desc));
    if (usable.length) {
      lines.push("\n## Ricambi utilizzati");
      for (const x of usable)
        lines.push(`- ${[x.code, x.desc, x.qty ? `q.tà ${x.qty}` : "", x.note].filter(Boolean).join(" · ")}`);
    }

    await upsertDerived({
      originKind: "rapportino",
      originId: r.id,
      type: "RAPPORTINO",
      title: `Rapportino ${i.code} — ${r.date.toLocaleDateString("it-IT")}`,
      body: lines.join("\n"),
      plantType: m?.plantType ?? null,
      model: m?.model ?? null,
      machineId: m?.id ?? null,
      customerId: i.customerId,
      tags: [i.type, r.issues?.trim() ? "problematica" : ""].filter(Boolean),
      updatedAt: r.updatedAt,
      stat,
    });
  }
  return stat;
}

/* ───────────────────────── Chat di cantiere ───────────────────────── */

/** Conversazioni di cantiere: la diagnosi vera si fa spesso in chat. */
export async function syncConversations(limit = 400): Promise<SyncStat> {
  const stat = empty();
  const rows = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      lastMessageAt: true,
      customerId: true,
      machine: { select: { id: true, code: true, plantType: true, model: true } },
      intervento: { select: { code: true, title: true, type: true } },
      customer: { select: { name: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        take: 200,
        select: { authorName: true, direction: true, body: true, sentAt: true },
      },
    },
  });

  for (const c of rows) {
    const body = c.messages
      .map((m) => m.body?.trim())
      .filter(Boolean)
      .length;
    if (body === 0) {
      stat.skipped++;
      continue;
    }
    const head: string[] = [`Conversazione: ${c.title}`];
    if (c.customer?.name) head.push(`Cliente: ${c.customer.name}`);
    if (c.machine) head.push(`Macchina: ${c.machine.code} ${c.machine.plantType ?? ""} ${c.machine.model ?? ""}`.trim());
    if (c.intervento) head.push(`Intervento: ${c.intervento.code} — ${c.intervento.title}`);

    const transcript = c.messages
      .filter((m) => m.body?.trim())
      .map(
        (m) =>
          `[${m.sentAt.toLocaleDateString("it-IT")}] ${m.direction === "OUT" ? "ZATO" : m.authorName}: ${m.body!.trim()}`
      )
      .join("\n");

    await upsertDerived({
      originKind: "conversation",
      originId: c.id,
      type: "CHAT",
      title: `Chat — ${c.title}`,
      body: `${head.join("\n")}\n\n## Conversazione\n${transcript}`,
      plantType: c.machine?.plantType ?? null,
      model: c.machine?.model ?? null,
      machineId: c.machine?.id ?? null,
      customerId: c.customerId,
      updatedAt: c.lastMessageAt ?? c.updatedAt,
      stat,
    });
  }
  return stat;
}

/* ───────────────────────── Diario macchina ───────────────────────── */

/**
 * Il diario è raggruppato per macchina, non per evento: cento eventi da due
 * righe l'uno diventerebbero cento fonti inutili, mentre la storia completa di
 * una macchina è un documento che risponde bene.
 */
export async function syncDiaries(limit = 200): Promise<SyncStat> {
  const stat = empty();
  const machines = await prisma.machine.findMany({
    where: { diaryEvents: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      code: true,
      plantType: true,
      model: true,
      customer: true,
      customerId: true,
      year: true,
      site: true,
      diaryEvents: {
        orderBy: { date: "desc" },
        take: 120,
        select: {
          date: true,
          phase: true,
          type: true,
          title: true,
          note: true,
          actorName: true,
          oldSerial: true,
          newSerial: true,
          componentRef: true,
          createdAt: true,
        },
      },
    },
  });

  for (const m of machines) {
    const last = m.diaryEvents[0]?.createdAt ?? new Date(0);
    const head = [
      `Diario macchina ${m.code}`,
      `Impianto: ${m.plantType ?? "n/d"} ${m.model ?? ""}`.trim(),
      `Anno: ${m.year} · Cliente: ${m.customer}${m.site ? " · Sito: " + m.site : ""}`,
    ];
    const events = m.diaryEvents.map((e) => {
      const bits = [`[${e.date.toLocaleDateString("it-IT")}] ${e.phase} · ${e.type}: ${e.title}`];
      if (e.note?.trim()) bits.push(`  ${e.note.trim()}`);
      if (e.componentRef) bits.push(`  Componente: ${e.componentRef}`);
      if (e.oldSerial || e.newSerial)
        bits.push(`  Matricola: ${e.oldSerial ?? "—"} → ${e.newSerial ?? "—"}`);
      if (e.actorName) bits.push(`  Operatore: ${e.actorName}`);
      return bits.join("\n");
    });

    await upsertDerived({
      originKind: "diary",
      originId: m.id,
      type: "DIARY",
      title: `Storico interventi — ${m.code}`,
      body: `${head.join("\n")}\n\n## Eventi\n${events.join("\n")}`,
      plantType: m.plantType,
      model: m.model,
      machineId: m.id,
      customerId: m.customerId,
      updatedAt: last,
      stat,
    });
  }
  return stat;
}

/* ───────────────────────── Articoli Knowledge ───────────────────────── */

/** Articoli scritti a mano nella Knowledge: entrano nell'indice come le altre fonti. */
export async function syncArticles(): Promise<SyncStat> {
  const stat = empty();
  const rows = await prisma.knowledgeArticle.findMany();
  for (const a of rows) {
    await upsertDerived({
      originKind: "article",
      originId: a.id,
      type: "ARTICLE",
      title: a.title,
      body: `${a.title}\nCategoria: ${a.category}${a.plantType ? " · " + a.plantType : ""}\n\n${a.body}`,
      plantType: a.plantType,
      tags: a.tags,
      updatedAt: a.updatedAt,
      stat,
    });
  }
  return stat;
}

export type CorpusSyncResult = {
  rapportini: SyncStat;
  chat: SyncStat;
  diari: SyncStat;
  articoli: SyncStat;
  durationMs: number;
};

/** Sincronizza tutto il corpus operativo. Pensato per un cron notturno. */
export async function syncCorpus(): Promise<CorpusSyncResult> {
  const t0 = Date.now();
  const rapportini = await syncRapportini();
  const chat = await syncConversations();
  const diari = await syncDiaries();
  const articoli = await syncArticles();
  return { rapportini, chat, diari, articoli, durationMs: Date.now() - t0 };
}
