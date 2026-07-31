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

  const [techs, scheduled, pending] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, zona: true },
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
    prisma.intervento.findMany({
      where: {
        status: { in: ["NUOVO", "PIANIFICATO"] },
        deletedAt: null,
        OR: [{ scheduledStart: null }, { scheduledStart: { lt: start } }],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: { id: true, code: true, title: true, priority: true, assignedTechId: true, customer: { select: { name: true } } },
    }),
  ]);

  const dayIndex = (iso: string) => daysArr.findIndex((d) => d.iso === iso);

  // Conflitti: un tecnico (responsabile O partecipante) su due interventi con
  // date sovrapposte. Chiave "<interventoId>|<techId>".
  const conflictKey = new Set<string>();
  {
    const byTech = new Map<string, { id: string; start: number; end: number }[]>();
    for (const s of scheduled) {
      const st = s.scheduledStart!.getTime();
      const en = (s.scheduledEnd ?? s.scheduledStart!).getTime();
      const team = new Set([s.assignedTechId, ...s.participants.map((p) => p.id)].filter((x): x is string => !!x));
      for (const techId of team) {
        const arr = byTech.get(techId) ?? [];
        arr.push({ id: s.id, start: st, end: en });
        byTech.set(techId, arr);
      }
    }
    for (const [techId, arr] of byTech) {
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          if (arr[i].start < arr[j].end && arr[j].start < arr[i].end) {
            conflictKey.add(`${arr[i].id}|${techId}`);
            conflictKey.add(`${arr[j].id}|${techId}`);
          }
        }
    }
  }

  const ganttTechs: GanttTech[] = techs.map((t) => {
    const blocks = scheduled
      .filter((s) => s.assignedTechId === t.id || s.participants.some((p) => p.id === t.id))
      .map((s) => {
        const sIso = isoDate(s.scheduledStart!);
        const eIso = isoDate(s.scheduledEnd ?? s.scheduledStart!);
        const di = Math.max(0, dayIndex(sIso));
        const rawDj = dayIndex(eIso);
        const dj = rawDj < 0 ? daysArr.length - 1 : rawDj;
        const len = Math.max(1, dj - di + 1);
        const role: "lead" | "member" = s.assignedTechId === t.id ? "lead" : "member";
        return { id: s.id, code: s.code, title: s.title, priority: s.priority, day: di, len, role };
      })
      .sort((a, b) => a.day - b.day);
    // conflitto: il tecnico è su due interventi sovrapposti (come responsabile
    // o partecipante) — usa il calcolo per data reale (conflictKey).
    const conflict = blocks.some((b) => conflictKey.has(`${b.id}|${t.id}`));
    return { id: t.id, name: t.name, zona: t.zona, blocks, conflict };
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
        supervisorConflict: s.assignedTechId ? conflictKey.has(`${s.id}|${s.assignedTechId}`) : false,
        participants: s.participants.map((p) => ({
          id: p.id,
          name: p.name,
          conflict: conflictKey.has(`${s.id}|${p.id}`),
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
      allTechs={techs}
      rangeLabel={label}
      canEdit={canEdit}
      prevDate={shift(-1)}
      nextDate={shift(1)}
      todayIso={todayIso}
    />
  );
}
