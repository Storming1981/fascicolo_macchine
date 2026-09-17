import { prisma } from "./db";
import { INTERVENTO_TYPE_META, PRIORITY_META, INTERVENTO_STATUS_META } from "./domain";
import { fmtDate, fmtDateTime } from "./format";
import type { NewNotification, NotifKind } from "./notifications";

/**
 * Costruisce il "brief di cantiere": tutto quello che il capo cantiere deve
 * sapere per andarci, ricavato dall'intervento così com'è stato creato
 * (cliente, cantiere, macchina, date, squadra, commessa, descrizione).
 *
 * La stessa struttura alimenta il pannello nell'app e la mail: se un dato
 * cambia si tocca solo qui e le due sponde restano allineate.
 */

export type Fact = { label: string; value: string };

export type InterventoBrief = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  facts: Fact[];
  /** Riga di sommario per il pannello (cliente · cantiere · data). */
  summary: string;
  leadId: string | null;
  leadName: string | null;
  participants: { id: string; name: string; email: string }[];
  machineId: string | null;
};

const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Intervallo di date leggibile: "dal 12/05/2026 al 16/05/2026" o un solo giorno. */
export function fmtRange(start: Date | null, end: Date | null): string | null {
  if (!start && !end) return null;
  if (start && end) {
    const a = fmtDate(start);
    const b = fmtDate(end);
    return a === b ? a : `dal ${a} al ${b}`;
  }
  return start ? `dal ${fmtDate(start)}` : `entro il ${fmtDate(end!)}`;
}

export async function loadInterventoBrief(id: string): Promise<InterventoBrief | null> {
  const i = await prisma.intervento.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, city: true, province: true, phone: true } },
      site: { select: { name: true, address: true, city: true, province: true } },
      machine: { select: { id: true, code: true, job: true, plantType: true, model: true } },
      tech: { select: { id: true, name: true } },
      participants: { select: { id: true, name: true, email: true } },
    },
  });
  if (!i) return null;

  const facts: Fact[] = [];
  facts.push({ label: "Tipo di intervento", value: INTERVENTO_TYPE_META[i.type]?.label ?? i.type });
  facts.push({ label: "Priorità", value: PRIORITY_META[i.priority]?.label ?? `P${i.priority}` });
  facts.push({ label: "Stato", value: INTERVENTO_STATUS_META[i.status]?.label ?? i.status });

  if (i.customer) {
    const where = [dash(i.customer.city), dash(i.customer.province)].filter(Boolean).join(" ");
    facts.push({ label: "Cliente", value: i.customer.name + (where ? ` — ${where}` : "") });
    if (dash(i.customer.phone)) facts.push({ label: "Telefono cliente", value: i.customer.phone! });
  }

  if (i.site) {
    const addr = [
      dash(i.site.address),
      [dash(i.site.city), dash(i.site.province)].filter(Boolean).join(" ") || null,
    ]
      .filter(Boolean)
      .join(" · ");
    facts.push({ label: "Cantiere", value: i.site.name + (addr ? ` — ${addr}` : "") });
  }

  if (i.machine) {
    const m = [dash(i.machine.plantType), dash(i.machine.model)].filter(Boolean).join(" ");
    facts.push({
      label: "Macchina",
      value: `${i.machine.code}${m ? ` — ${m}` : ""}${i.machine.job ? ` (job ${i.machine.job})` : ""}`,
    });
  }

  if (dash(i.commessa)) facts.push({ label: "Commessa cantiere", value: i.commessa! });

  const range = fmtRange(i.scheduledStart, i.scheduledEnd);
  facts.push({ label: "Periodo previsto", value: range ?? "da pianificare" });
  if (i.slaDueAt) facts.push({ label: "Scadenza SLA", value: fmtDateTime(i.slaDueAt) });

  if (i.tech) facts.push({ label: "Capo cantiere", value: i.tech.name });
  if (i.participants.length)
    facts.push({ label: "Squadra", value: i.participants.map((p) => p.name).join(", ") });

  if (dash(i.reportedBy)) facts.push({ label: "Segnalato da", value: i.reportedBy! });

  const summary = [i.customer?.name ?? null, i.site?.name ?? null, range].filter(Boolean).join(" · ");

  return {
    id: i.id,
    code: i.code,
    title: i.title,
    description: dash(i.description),
    facts,
    summary,
    leadId: i.assignedTechId,
    leadName: i.tech?.name ?? null,
    participants: i.participants,
    machineId: i.machineId,
  };
}

/** Corpo testuale della notifica: una riga per dato, poi la descrizione. */
export function briefToText(b: InterventoBrief): string {
  const lines = [`${b.code} — ${b.title}`, ""];
  for (const f of b.facts) lines.push(`${f.label}: ${f.value}`);
  if (b.description) lines.push("", "Descrizione:", b.description);
  return lines.join("\n");
}

/* ───────────────────────── Notifiche pronte da salvare ───────────────────── */

export type Notice = {
  notification: NewNotification;
  /** Dati per la mail: il brief viene reso in HTML al momento dell'invio. */
  mail: { subject: string; intro: string; brief: InterventoBrief };
};

function notice(
  kind: NotifKind,
  opts: {
    userId: string;
    title: string;
    intro: string;
    brief: InterventoBrief;
    tone: NewNotification["tone"];
    icon: string;
    actor: { id: string; name: string };
    emailTo: string | null;
  }
): Notice {
  return {
    notification: {
      userId: opts.userId,
      kind,
      title: opts.title,
      body: `${opts.intro}\n\n${briefToText(opts.brief)}`,
      tone: opts.tone,
      icon: opts.icon,
      href: `/service/interventi/${opts.brief.id}`,
      interventoId: opts.brief.id,
      machineId: opts.brief.machineId,
      actorId: opts.actor.id,
      actorName: opts.actor.name,
      emailTo: opts.emailTo,
    },
    mail: { subject: opts.title, intro: opts.intro, brief: opts.brief },
  };
}

/**
 * Notifiche da mandare dopo un cambio di assegnazione/pianificazione.
 *
 * `before` è lo stato PRIMA della modifica: serve a capire chi è entrato, chi
 * è uscito e se le date si sono mosse. Senza, ogni salvataggio della scheda
 * rispedirebbe la stessa notifica e la mail alle stesse persone.
 */
export async function buildAssignmentNotices(
  brief: InterventoBrief,
  before: {
    leadId: string | null;
    participantIds: string[];
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
  },
  actor: { id: string; name: string }
): Promise<Notice[]> {
  const out: Notice[] = [];
  const leadChanged = brief.leadId !== before.leadId;
  const afterParts = brief.participants.map((p) => p.id);
  const added = afterParts.filter((id) => !before.participantIds.includes(id));
  const removed = before.participantIds.filter((id) => !afterParts.includes(id));

  const periodNow = brief.facts.find((f) => f.label === "Periodo previsto")?.value ?? "";
  const datesChanged = periodNow !== (fmtRange(before.scheduledStart, before.scheduledEnd) ?? "da pianificare");

  // Indirizzi e-mail dei coinvolti (solo utenti attivi: un disattivato non va avvisato).
  const ids = [brief.leadId, before.leadId, ...afterParts, ...removed].filter(
    (x): x is string => !!x
  );
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(ids)] } },
        select: { id: true, email: true, active: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const mailOf = (id: string) => {
    const u = byId.get(id);
    return u && u.active ? u.email : null;
  };

  // 1. Nuovo capo cantiere: la notifica principale, col brief completo.
  if (leadChanged && brief.leadId) {
    out.push(
      notice("INTERVENTO_ASSEGNATO", {
        userId: brief.leadId,
        title: `Sei il capo cantiere di ${brief.code}`,
        intro: `${actor.name} ti ha assegnato come capo cantiere dell'intervento ${brief.code} — ${brief.title}.`,
        brief,
        tone: "alert",
        icon: "flag",
        actor,
        emailTo: mailOf(brief.leadId),
      })
    );
  }

  // 1-bis. Il capo cantiere sostituito. Senza questo, chi viene tolto
  // continuerebbe a organizzarsi per un cantiere che non è più suo: e' il caso
  // che fa piu' danno, perche' due persone si preparano per lo stesso lavoro.
  if (leadChanged && before.leadId && !afterParts.includes(before.leadId)) {
    out.push(
      notice("INTERVENTO_RIMOSSO", {
        userId: before.leadId,
        title: `Non sei più il capo cantiere di ${brief.code}`,
        intro: `${actor.name} ha passato l'intervento ${brief.code} — ${brief.title}${
          brief.leadName ? ` a ${brief.leadName}` : " a un altro capo cantiere"
        }.`,
        brief,
        tone: "warn",
        icon: "x",
        actor,
        emailTo: mailOf(before.leadId),
      })
    );
  }

  // 2. Chi entra in squadra: stesso brief, tono più leggero.
  for (const id of added) {
    if (id === brief.leadId) continue;
    out.push(
      notice("INTERVENTO_SQUADRA", {
        userId: id,
        title: `Sei in squadra su ${brief.code}`,
        intro: `${actor.name} ti ha inserito nella squadra dell'intervento ${brief.code} — ${brief.title}${
          brief.leadName ? `, capo cantiere ${brief.leadName}` : ""
        }.`,
        brief,
        tone: "info",
        icon: "people",
        actor,
        emailTo: mailOf(id),
      })
    );
  }

  // 3. Chi esce: senza avviso continuerebbe a organizzarsi per andarci.
  for (const id of removed) {
    out.push(
      notice("INTERVENTO_RIMOSSO", {
        userId: id,
        title: `Non sei più in squadra su ${brief.code}`,
        intro: `${actor.name} ti ha tolto dalla squadra dell'intervento ${brief.code} — ${brief.title}.`,
        brief,
        tone: "warn",
        icon: "x",
        actor,
        emailTo: mailOf(id),
      })
    );
  }

  // 4. Date spostate, per chi era già assegnato prima.
  if (datesChanged) {
    const staying = [
      ...(brief.leadId && !leadChanged ? [brief.leadId] : []),
      ...afterParts.filter((id) => !added.includes(id) && id !== brief.leadId),
    ];
    for (const id of staying) {
      out.push(
        notice("INTERVENTO_RIPROGRAMMATO", {
          userId: id,
          title: `Cantiere riprogrammato: ${brief.code}`,
          intro: `${actor.name} ha spostato le date dell'intervento ${brief.code} — ${brief.title}.`,
          brief,
          tone: "warn",
          icon: "clock",
          actor,
          emailTo: mailOf(id),
        })
      );
    }
  }

  // Chi fa la modifica non si autonotifica: lo sa già.
  return out.filter((n) => n.notification.userId !== actor.id);
}
