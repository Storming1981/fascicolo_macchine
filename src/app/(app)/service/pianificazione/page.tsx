import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { userCan } from "@/lib/settings";
import { prisma } from "@/lib/db";
import PianificazioneClient, {
  type GanttDay,
  type GanttTech,
  type PendingItem,
} from "./PianificazioneClient";

export const dynamic = "force-dynamic";

const DAYS = 14;
const WEEKDAYS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export default async function PianificazionePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user.role, "service.view"))) redirect("/dashboard");
  const canEdit = await userCan(user.role, "intervento.edit");

  // finestra di 14 giorni a partire da oggi
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + DAYS);

  const todayIso = start.toISOString().slice(0, 10);
  let prevMonth = -1;
  const days: GanttDay[] = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dow = d.getDay();
    const m = d.getMonth();
    const showMonth = i === 0 || m !== prevMonth;
    prevMonth = m;
    return {
      iso: d.toISOString().slice(0, 10),
      dayNum: d.getDate(),
      weekday: WEEKDAYS[dow],
      weekend: dow === 0 || dow === 6,
      today: d.toISOString().slice(0, 10) === todayIso,
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
      where: { assignedTechId: { not: null }, scheduledStart: { gte: start, lt: end } },
      select: {
        id: true,
        code: true,
        title: true,
        priority: true,
        assignedTechId: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
    }),
    prisma.intervento.findMany({
      where: { status: { in: ["NUOVO", "PIANIFICATO"] }, scheduledStart: null },
      orderBy: { priority: "asc" },
      select: { id: true, code: true, title: true, priority: true, assignedTechId: true, customer: { select: { name: true } } },
    }),
  ]);

  const dayIndex = (iso: string) => days.findIndex((d) => d.iso === iso);

  const ganttTechs: GanttTech[] = techs.map((t) => {
    const blocks = scheduled
      .filter((s) => s.assignedTechId === t.id)
      .map((s) => {
        const sIso = s.scheduledStart!.toISOString().slice(0, 10);
        const eIso = (s.scheduledEnd ?? s.scheduledStart!).toISOString().slice(0, 10);
        const di = Math.max(0, dayIndex(sIso));
        const dj = eIso ? dayIndex(eIso) : di;
        const len = Math.max(1, (dj < 0 ? di : dj) - di + 1);
        return { id: s.id, code: s.code, title: s.title, priority: s.priority, day: di, len };
      })
      .sort((a, b) => a.day - b.day);

    // conflitti: blocchi che si sovrappongono nello stesso giorno
    const conflict = blocks.some((b, i) =>
      blocks.some((o, j) => j !== i && b.day < o.day + o.len && o.day < b.day + b.len)
    );

    return { id: t.id, name: t.name, zona: t.zona, blocks, conflict };
  });

  const pendingItems: PendingItem[] = pending.map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    priority: p.priority,
    customer: p.customer?.name ?? null,
    assignedTechId: p.assignedTechId,
  }));

  const label = `${days[0].dayNum} ${MONTHS[start.getMonth()]} — ${days[DAYS - 1].dayNum} ${
    MONTHS[new Date(days[DAYS - 1].iso).getMonth()]
  } ${start.getFullYear()}`;

  return (
    <PianificazioneClient
      days={days}
      techs={ganttTechs}
      pending={pendingItems}
      allTechs={techs}
      rangeLabel={label}
      canEdit={canEdit}
    />
  );
}
