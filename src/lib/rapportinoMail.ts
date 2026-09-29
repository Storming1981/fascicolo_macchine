import "server-only";
import { prisma } from "./db";
import { renderRapportinoPdf } from "./rapportinoRender";
import { readUploadBytes } from "./uploads";
import { isGoogleConfigured, sendGmailAs, type MailAttachment } from "./google";
import { isFeedConfigured, fetchOpenSessionsForCommessa } from "./presenceFeed";
import { fmtDate, fmtHM } from "./format";
import { syncInterventoOre } from "./rapportinoOre";
import {
  mergeRapportinoMail,
  mergeRapportinoMailState,
  type RapportinoMailConfig,
  type RapportinoMailState,
} from "./rapportinoMailConfig";

export type { RapportinoMailConfig, RapportinoMailState };

/**
 * Invio automatico dei rapportini giornalieri.
 *
 * A un'ora fissa (configurabile) parte una mail **per ogni rapportino chiuso**
 * non ancora inviato, con il PDF in allegato, a una lista di indirizzi
 * configurabile in Impostazioni. Il mittente è la casella Gmail aziendale:
 * l'automazione non ha un utente che preme il bottone.
 *
 * Perché non basta l'invio manuale: il rapportino si firma in cantiere, ma chi
 * lo deve leggere in sede aspetta che qualcuno si ricordi di spedirlo.
 */

/** Autore delle revisioni scritte dall'automazione (nessun utente dietro). */
const SYSTEM_ACTOR = { id: null as string | null, name: "Invio automatico rapportini" };

const CONFIG_KEY = "rapportinoMail";
const STATE_KEY = "rapportinoMailState";

export async function getRapportinoMailConfig(): Promise<RapportinoMailConfig> {
  const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
  return mergeRapportinoMail(row?.value);
}

export async function saveRapportinoMailConfig(value: unknown): Promise<RapportinoMailConfig> {
  const cfg = mergeRapportinoMail(value);
  // L'accensione la registra il server, non il client: da quel momento in poi
  // l'automatico spedisce, e l'arretrato precedente resta fermo.
  const prev = await getRapportinoMailConfig();
  if (!cfg.enabled) cfg.activatedAt = null;
  else cfg.activatedAt = prev.enabled && prev.activatedAt ? prev.activatedAt : new Date().toISOString();
  await prisma.setting.upsert({
    where: { key: CONFIG_KEY },
    update: { value: cfg },
    create: { key: CONFIG_KEY, value: cfg },
  });
  return cfg;
}

export async function getRapportinoMailState(): Promise<RapportinoMailState> {
  const row = await prisma.setting.findUnique({ where: { key: STATE_KEY } });
  return mergeRapportinoMailState(row?.value);
}

async function saveState(state: RapportinoMailState) {
  await prisma.setting.upsert({
    where: { key: STATE_KEY },
    update: { value: state },
    create: { key: STATE_KEY, value: state },
  });
}

/** "YYYY-MM-DD" in ora locale del server (= ora italiana). */
const isoDay = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

/**
 * Rapportini da spedire: **chiusi** (quindi firmati) e mai inviati, dagli
 * ultimi `maxDays` giorni. Le bozze restano fuori: un rapportino non firmato
 * non è un documento da mandare al cliente.
 */
export async function pendingRapportini(cfg: RapportinoMailConfig, opts: { sinceActivation?: boolean } = {}) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (cfg.maxDays - 1));
  // Giro automatico: mai prima del giorno in cui l'invio è stato acceso.
  if (opts.sinceActivation && cfg.activatedAt) {
    const since = new Date(cfg.activatedAt);
    since.setHours(0, 0, 0, 0);
    if (since > from) from.setTime(since.getTime());
  }
  return prisma.rapportino.findMany({
    where: { closed: true, sentAt: null, date: { gte: from } },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      hoursWorked: true,
      techName: true,
      intervento: {
        select: {
          id: true,
          code: true,
          title: true,
          commessa: true,
          customer: { select: { name: true, email: true } },
          site: { select: { name: true, city: true } },
        },
      },
    },
  });
}

type Pending = Awaited<ReturnType<typeof pendingRapportini>>[number];

/** Timbrature ancora aperte in quella giornata → ore parziali, si rimanda. */
async function hasOpenStampings(r: Pending): Promise<boolean> {
  if (!r.intervento.commessa || !isFeedConfigured()) return false;
  try {
    const open = await fetchOpenSessionsForCommessa(r.intervento.commessa);
    const day = isoDay(r.date);
    return open.some((o) => isoDay(o.startedAt ?? new Date()) === day);
  } catch {
    return false; // timbratore irraggiungibile: non blocchiamo l'invio
  }
}

function mailFor(r: Pending, cfg: RapportinoMailConfig) {
  const it = r.intervento;
  const giorno = fmtDate(r.date);
  const cliente = it.customer?.name ?? null;
  const cantiere = [it.site?.name, it.site?.city].filter(Boolean).join(" · ") || null;

  const subject = `Rapportino ${it.code} — ${giorno}${cliente ? ` — ${cliente}` : ""}`;
  const righe = [
    "Buongiorno,",
    "",
    `in allegato il rapportino dell'intervento ${it.code} (${it.title}) del ${giorno}.`,
    "",
    ...(cliente ? [`Cliente: ${cliente}`] : []),
    ...(cantiere ? [`Cantiere: ${cantiere}`] : []),
    ...(it.commessa ? [`Commessa: ${it.commessa}`] : []),
    ...(r.hoursWorked != null ? [`Ore della giornata: ${fmtHM(r.hoursWorked)}`] : []),
    ...(r.techName ? [`Compilato da: ${r.techName}`] : []),
    "",
    "Cordiali saluti,",
    "ZATO Service",
  ];
  return { subject, text: righe.join("\n") };
}

/** Invia un singolo rapportino e ne traccia l'esito su sentAt/sentTo. */
async function sendOne(r: Pending, cfg: RapportinoMailConfig): Promise<string> {
  // Le ore salvate sul rapportino sono quelle del momento della FIRMA, cioè
  // parziali: il tecnico firma mentre è ancora timbrato. Prima di generare il
  // PDF si rilegge il timbratore per quella giornata — è il motivo per cui il
  // rapportino si spedisce il giorno dopo, e senza questo passaggio partirebbe
  // con le ore incomplete senza che nessuno se ne accorga.
  try {
    await syncInterventoOre(
      r.intervento.id,
      { id: SYSTEM_ACTOR.id, name: SYSTEM_ACTOR.name },
      { onlyRapportinoId: r.id }
    );
  } catch {
    // timbratore irraggiungibile: si spedisce con le ore che si hanno,
    // meglio del rapportino che non parte affatto
  }

  const out = await renderRapportinoPdf(r.id);
  if (!out) throw new Error("PDF non generato");

  const attachments: MailAttachment[] = [
    { filename: out.filename, mimeType: "application/pdf", content: Buffer.from(out.bytes) },
  ];
  if (cfg.includeAttachments) {
    const atts = await prisma.rapportinoAttachment.findMany({
      where: { rapportinoId: r.id },
      orderBy: { createdAt: "asc" },
    });
    for (const a of atts) {
      const file = await readUploadBytes(a.path);
      if (file) attachments.push({ filename: a.filename, mimeType: a.mime || file.mime, content: file.bytes });
    }
  }

  const cc = [...cfg.cc];
  const clientMail = r.intervento.customer?.email;
  if (cfg.includeCustomer && clientMail && !cfg.to.includes(clientMail) && !cc.includes(clientMail))
    cc.push(clientMail);

  const { subject, text } = mailFor(r, cfg);
  // userId vuoto = nessuna casella personale → parte da quella aziendale:
  // l'invio automatico non ha un utente che lo sta facendo.
  await sendGmailAs("", { to: cfg.to, cc, subject, text, attachments });

  const destinatari = [...cfg.to, ...cc].join(", ");
  await prisma.rapportino.update({
    where: { id: r.id },
    data: { sentAt: new Date(), sentTo: destinatari },
  });
  return destinatari;
}

export type RunSummary = {
  ok: boolean;
  sent: number;
  skipped: number;
  errors: string[];
  /** Motivo per cui il giro non è partito affatto (configurazione incompleta). */
  reason?: string;
};

/**
 * Esegue il giro di invio. `force` salta il controllo dell'orario e del
 * "già fatto oggi": è il pulsante *Invia adesso* delle Impostazioni.
 */
export async function runRapportinoMail(opts: { force?: boolean } = {}): Promise<RunSummary> {
  const cfg = await getRapportinoMailConfig();
  if (!opts.force && !cfg.enabled) return { ok: false, sent: 0, skipped: 0, errors: [], reason: "Invio automatico disattivato" };
  if (cfg.to.length === 0)
    return { ok: false, sent: 0, skipped: 0, errors: [], reason: "Nessun destinatario configurato" };
  if (!isGoogleConfigured())
    return { ok: false, sent: 0, skipped: 0, errors: [], reason: "Google non configurato" };

  // A mano si spedisce tutta la finestra (l'utente vede quanti sono);
  // in automatico solo da quando l'invio è stato acceso.
  const list = await pendingRapportini(cfg, { sinceActivation: !opts.force });
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const r of list) {
    try {
      if (await hasOpenStampings(r)) {
        // ore ancora parziali: riproverà al prossimo giro, quando l'operatore
        // avrà registrato l'uscita e le ore saranno complete
        skipped++;
        continue;
      }
      await sendOne(r, cfg);
      sent++;
    } catch (e) {
      errors.push(`${r.intervento.code} ${fmtDate(r.date)}: ${e instanceof Error ? e.message : "errore"}`);
    }
  }

  const now = new Date();
  // `lastRunDay` è il segnaposto del GIRO AUTOMATICO ("oggi l'ho già fatto").
  // Un *Invia adesso* non deve consumarlo, altrimenti chi prova la funzione al
  // mattino spegne senza saperlo l'invio automatico di quella giornata.
  const prev = await getRapportinoMailState();
  await saveState({
    lastRunDay: opts.force ? prev.lastRunDay : isoDay(now),
    lastRunAt: now.toISOString(),
    lastSent: sent,
    lastSkipped: skipped,
    lastErrors: errors.slice(0, 10),
  });

  return { ok: true, sent, skipped, errors };
}

/**
 * Tick dello scheduler: invia se è arrivata l'ora e oggi non si è già inviato.
 * Il "già fatto oggi" sta in banca dati, non in memoria: un riavvio del
 * container a metà pomeriggio non deve far ripartire l'invio da capo.
 */
export async function runRapportinoMailIfDue(): Promise<RunSummary | null> {
  const cfg = await getRapportinoMailConfig();
  if (!cfg.enabled || cfg.to.length === 0) return null;

  const now = new Date();
  const [hh, mm] = cfg.time.split(":").map(Number);
  const due = new Date(now);
  due.setHours(hh, mm, 0, 0);
  if (now < due) return null;

  const state = await getRapportinoMailState();
  if (state.lastRunDay === isoDay(now)) return null;

  return runRapportinoMail();
}
