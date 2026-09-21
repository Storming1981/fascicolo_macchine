import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import PianificazioneClient, {
  type GanttDay,
  type GanttTech,
  type PendingItem,
  type MonthDay,
  type InterventoRow,
} from "./PianificazioneClient";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
// Data locale YYYY-MM-DD (NON UTC): le colonne del Gantt e le date pianificate
// devono coincidere nel fuso locale, altrimenti a mezzanotte l'ISO UTC scala di
// un giorno e i blocchi finiscono nella colonna sbagliata.
const isoDate = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

type View = "week" | "gantt" | "month";

export default async function PianificazionePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; group?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");
  const canEdit = await userCan(user.role, "intervento.edit");

  const sp = await searchParams;
  const view: View = sp.view === "week" || sp.view === "month" ? sp.view : "gantt";
  const group: "tecnici" | "cantieri" = sp.group === "cantieri" ? "cantieri" : "tecnici";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const anchor = sp.date ? new Date(sp.date + "T00:00:00") : new Date(today);
  anchor.setHours(0, 0, 0, 0);

  // finestra secondo la vista
  let start: Date;
  let count: number;
  if (view === "week") {
    start = new Date(anchor);
    start.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7)); // lunedì
    count = 7;
  } else if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // lunedì prima del 1°
    count = 42; // 6 settimane
  } else {
    start = sp.date ? new Date(anchor) : new Date(today);
    count = 14;
  }
  const end = new Date(start);
  end.setDate(start.getDate() + count);

  const todayIso = isoDate(today);
  let prevMonth = -1;
  const daysArr: GanttDay[] = Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dow = d.getDay();
    const m = d.getMonth();
    const showMonth = i === 0 || m !== prevMonth;
    prevMonth = m;
    return {
      iso: isoDate(d),
      dayNum: d.getDate(),
      weekday: WEEKDAYS[dow],
      weekend: dow === 0 || dow === 6,
      today: isoDate(d) === todayIso,
      month: MONTHS[m],
      showMonth,
    };
  });

  const [techs, turni, scheduled, pending, posBlocked] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, zona: true },
    }),
    // Turni di presenza che toccano la finestra visualizzata: sono loro a
    // disegnare il Gantt, non piu' la finestra unica dell'intervento.
    prisma.interventoTurno.findMany({
      where: { start: { lt: end }, end: { gte: start }, intervento: { deletedAt: null } },
      select: {
        id: true,
        userId: true,
        role: true,
        start: true,
        end: true,
        overlapOk: true,
        intervento: {
          select: { id: true, code: true, title: true, priority: true, customer: { select: { name: true } } },
        },
      },
    }),
    prisma.intervento.findMany({
      where: { assignedTechId: { not: null }, scheduledStart: { gte: start, lt: end }, deletedAt: null },
      select: {
        id: true,
        code: true,
        title: true,
        priority: true,
        assignedTechId: true,
        scheduledStart: true,
        scheduledEnd: true,
        tech: { select: { name: true } },
        participants: { select: { id: true, name: true } },
        customer: { select: { name: true } },
      },
    }),
    // Da pianificare: solo interventi con P.O.S. validato (gli altri sono bloccati)
    prisma.intervento.findMany({
      where: {
        status: { in: ["NUOVO", "PIANIFICATO"] },
        posValidated: true,
        deletedAt: null,
        OR: [{ scheduledStart: null }, { scheduledStart: { lt: start } }],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: { id: true, code: true, title: true, priority: true, assignedTechId: true, customer: { select: { name: true } } },
    }),
    // Bloccati dal P.O.S.: contano solo per avvisare il pianificatore
    prisma.intervento.count({
      where: { status: "DOCUMENTAZIONE", posValidated: false, deletedAt: null },
    }),
  ]);

  const dayIndex = (iso: string) => daysArr.findIndex((d) => d.iso === iso);

  // Conflitti: due TURNI della stessa persona che si sovrappongono. Prima si
  // confrontavano le finestre degli interventi, che erano condivise da tutta la
  // squadra: ora il confronto e' sulla presenza reale della singola persona.
  const conflictTurno = new Set<string>();
  {
    const byUser = new Map<string, { id: string; s: number; e: number; ok: boolean }[]>();
    for (const t of turni) {
      const arr = byUser.get(t.userId) ?? [];
      arr.push({ id: t.id, s: t.start.getTime(), e: t.end.getTime(), ok: t.overlapOk });
      byUser.set(t.userId, arr);
    }
    for (const arr of byUser.values())
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          if (arr[i].ok || arr[j].ok) continue; // sovrapposizione voluta
          if (arr[i].s <= arr[j].e && arr[j].s <= arr[i].e) {
            conflictTurno.add(arr[i].id);
            conflictTurno.add(arr[j].id);
          }
        }
  }

  // Stessa informazione vista per intervento+persona, per la vista "Per cantiere".
  const conflictPair = new Set<string>();
  for (const t of turni)
    if (conflictTurno.has(t.id)) conflictPair.add(`${t.intervento.id}|${t.userId}`);

  const ganttTechs: GanttTech[] = techs.map((t) => {
    const blocks = turni
      .filter((x) => x.userId === t.id)
      .map((x) => {
        const di = Math.max(0, dayIndex(isoDate(x.start)));
        const rawDj = dayIndex(isoDate(x.end));
        const dj = rawDj < 0 ? daysArr.length - 1 : rawDj;
        return {
          turnoId: x.id,
          id: x.intervento.id,
          code: x.intervento.code,
          title: x.intervento.title,
          priority: x.intervento.priority,
          day: di,
          len: Math.max(1, dj - di + 1),
          role: (x.role === "lead" ? "lead" : "member") as "lead" | "member",
          conflict: conflictTurno.has(x.id),
        };
      })
      .sort((a, b) => a.day - b.day);
    return { id: t.id, name: t.name, zona: t.zona, blocks, conflict: blocks.some((b) => b.conflict) };
  });

  // vista mese: interventi per giorno (espansi sulla durata)
  let monthDays: MonthDay[] = [];
  if (view === "month") {
    const byDay: Record<string, MonthDay["items"]> = {};
    for (const s of scheduled) {
      const sIso = isoDate(s.scheduledStart!);
      const eIso = isoDate(s.scheduledEnd ?? s.scheduledStart!);
      const cur = new Date(sIso + "T00:00:00");
      const last = new Date(eIso + "T00:00:00");
      while (cur <= last) {
        const iso = isoDate(cur);
        if (iso >= daysArr[0].iso && iso <= daysArr[count - 1].iso) {
          (byDay[iso] ??= []).push({
            id: s.id,
            code: s.code,
            title: s.title,
            priority: s.priority,
            tech: s.tech?.name ?? null,
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    monthDays = daysArr.map((d) => ({
      ...d,
      inMonth: new Date(d.iso + "T00:00:00").getMonth() === anchor.getMonth(),
      items: byDay[d.iso] ?? [],
    }));
  }

  // Vista "per cantiere": una riga per intervento pianificato, con la squadra.
  const interventiRows: InterventoRow[] = scheduled
    .map((s) => {
      const sIso = isoDate(s.scheduledStart!);
      const eIso = isoDate(s.scheduledEnd ?? s.scheduledStart!);
      const di = Math.max(0, dayIndex(sIso));
      const rawDj = dayIndex(eIso);
      const dj = rawDj < 0 ? daysArr.length - 1 : rawDj; // fine oltre la finestra → bordo
      const len = Math.max(1, dj - di + 1);
      return {
        id: s.id,
        code: s.code,
        title: s.title,
        priority: s.priority,
        customer: s.customer?.name ?? null,
        day: di,
        len,
        supervisorId: s.assignedTechId,
        supervisorName: s.tech?.name ?? null,
        supervisorConflict: s.assignedTechId ? conflictPair.has(`${s.id}|${s.assignedTechId}`) : false,
        participants: s.participants.map((p) => ({
          id: p.id,
          name: p.name,
          conflict: conflictPair.has(`${s.id}|${p.id}`),
        })),
      };
    })
    .sort((a, b) => a.day - b.day || a.priority - b.priority);

  const pendingItems: PendingItem[] = pending.map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    priority: p.priority,
    customer: p.customer?.name ?? null,
    assignedTechId: p.assignedTechId,
  }));

  // navigazione
  const shift = (dir: number) => {
    const r = new Date(anchor);
    if (view === "month") r.setMonth(anchor.getMonth() + dir);
    else if (view === "week") r.setDate(anchor.getDate() + dir * 7);
    else r.setDate(anchor.getDate() + dir * 14);
    return isoDate(r);
  };

  const label =
    view === "month"
      ? `${["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"][anchor.getMonth()]} ${anchor.getFullYear()}`
      : `${daysArr[0].dayNum} ${daysArr[0].month} — ${daysArr[count - 1].dayNum} ${daysArr[count - 1].month} ${new Date(daysArr[count - 1].iso + "T00:00:00").getFullYear()}`;

  return (
    <PianificazioneClient
      view={view}
      group={group}
      days={daysArr}
      monthDays={monthDays}
      techs={ganttTechs}
      interventiRows={interventiRows}
      pending={pendingItems}
      posBlocked={posBlocked}
      allTechs={techs}
      rangeLabel={label}
      canEdit={canEdit}
      prevDate={shift(-1)}
      nextDate={shift(1)}
      todayIso={todayIso}
    />
  );
}
