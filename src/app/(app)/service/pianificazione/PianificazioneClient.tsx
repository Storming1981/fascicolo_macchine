"use client";
import { useEffect, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { PRIORITY_META, initials } from "@/lib/domain";

type LiveTech = {
  userId: string | null;
  techName: string | null;
  siteName: string | null;
  customerName: string | null;
  commessa: string | null;
  clockIn: string;
};

export type GanttDay = {
  iso: string;
  dayNum: number;
  weekday: string;
  weekend: boolean;
  today: boolean;
  month: string;
  showMonth: boolean;
};

export type MonthItem = { id: string; code: string; title: string; priority: number; tech: string | null };
export type MonthDay = GanttDay & { inMonth: boolean; items: MonthItem[] };
type Block = { id: string; code: string; title: string; priority: number; day: number; len: number; role?: "lead" | "member" };
export type GanttTech = {
  id: string;
  name: string;
  zona: string | null;
  blocks: Block[];
  conflict: boolean;
};
export type PendingItem = {
  id: string;
  code: string;
  title: string;
  priority: number;
  customer: string | null;
  assignedTechId: string | null;
};
type Tech = { id: string; name: string; zona: string | null };

export default function PianificazioneClient({
  view,
  days,
  monthDays,
  techs,
  pending,
  allTechs,
  rangeLabel,
  canEdit,
  prevDate,
  nextDate,
  todayIso,
}: {
  view: "week" | "gantt" | "month";
  days: GanttDay[];
  monthDays: MonthDay[];
  techs: GanttTech[];
  pending: PendingItem[];
  allTechs: Tech[];
  rangeLabel: string;
  canEdit: boolean;
  prevDate: string;
  nextDate: string;
  todayIso: string;
}) {
  const router = useRouter();
  const colW = `calc(100% / ${days.length})`;
  const conflicts = techs.filter((t) => t.conflict);

  const go = (v: string, date?: string) =>
    router.push(`/service/pianificazione?view=${v}${date ? `&date=${date}` : ""}`);

  const [live, setLive] = useState<LiveTech[]>([]);
  const [showTimbra, setShowTimbra] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [dropTech, setDropTech] = useState<string | null>(null);

  async function patchPlan(id: string, techId: string, dayIso: string, nDays = 1) {
    const start = new Date(`${dayIso}T09:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + (nDays - 1));
    end.setHours(18, 0, 0, 0);
    await fetch(`/api/interventi/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignedTechId: techId,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        status: "PIANIFICATO",
      }),
    });
  }
  async function schedule(id: string, techId: string, dayIso: string) {
    await patchPlan(id, techId, dayIso);
    router.refresh();
  }

  type ConflictInfo = { id: string; title: string; prio: number; techId: string; techName: string; dayIso: string; dayLabel: string; other: Block };
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  function overlapBlock(blocks: Block[], day: number, len: number, exceptId?: string): Block | undefined {
    // i conflitti riguardano solo gli interventi di cui il tecnico è responsabile
    return blocks.find(
      (b) => b.role !== "member" && b.id !== exceptId && day < b.day + b.len && b.day < day + len
    );
  }
  function draggedLabel(id: string): { title: string; prio: number } {
    const p = pending.find((x) => x.id === id);
    if (p) return { title: p.title, prio: p.priority };
    const b = techs.flatMap((t) => t.blocks).find((x) => x.id === id);
    return b ? { title: b.title, prio: b.priority } : { title: "Intervento", prio: 3 };
  }

  function dropOnTech(e: DragEvent<HTMLDivElement>, techId: string) {
    e.preventDefault();
    setDropTech(null);
    const id = e.dataTransfer.getData("text/intervento");
    if (!id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.max(0, Math.min(days.length - 1, Math.floor((e.clientX - rect.left) / (rect.width / days.length))));
    const t = techs.find((x) => x.id === techId);
    const other = t ? overlapBlock(t.blocks, idx, 1, id) : undefined;
    if (other && t) {
      const d = days[idx];
      const dl = draggedLabel(id);
      setConflict({ id, title: dl.title, prio: dl.prio, techId, techName: t.name, dayIso: d.iso, dayLabel: `${d.weekday} ${d.dayNum} ${d.month}`, other });
    } else {
      schedule(id, techId, days[idx].iso);
    }
  }

  async function resolveKeep() {
    if (!conflict) return;
    await patchPlan(conflict.id, conflict.techId, conflict.dayIso);
    setConflict(null);
    router.refresh();
  }
  async function resolveMoveOther() {
    if (!conflict) return;
    const curIdx = days.findIndex((d) => d.iso === conflict.dayIso);
    const nextIdx = Math.min(days.length - 1, curIdx + 1);
    await patchPlan(conflict.other.id, conflict.techId, days[nextIdx].iso, conflict.other.len);
    await patchPlan(conflict.id, conflict.techId, conflict.dayIso);
    setConflict(null);
    router.refresh();
  }

  // ridimensionamento blocchi (durata in giorni)
  const [resize, setResize] = useState<{ id: string; day: number; baseLen: number; previewLen: number; cellW: number; startX: number } | null>(null);
  async function setSpan(id: string, startIso: string, nDays: number) {
    const start = new Date(`${startIso}T09:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + (nDays - 1));
    end.setHours(18, 0, 0, 0);
    await fetch(`/api/interventi/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() }),
    });
    router.refresh();
  }
  async function loadLive() {
    const res = await fetch("/api/presence/live");
    const d = await res.json().catch(() => null);
    if (res.ok) setLive(d.presences ?? []);
  }
  async function syncTimbrature() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/presence/sync", { method: "POST" });
      const d = await res.json().catch(() => null);
      setSyncMsg(
        res.ok ? `Lette ${d.fetched} · on-site ${d.open} · chiuse ${d.closed}` : d?.error ?? "Errore sync"
      );
      if (res.ok) loadLive();
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    loadLive();
  }, []);
  const liveByTech = new Map(live.filter((l) => l.userId).map((l) => [l.userId as string, l]));

  // ricerca + ordinamento (on-site prima) + paginazione tecnici
  const filtered = techs
    .filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (liveByTech.has(b.id) ? 1 : 0) - (liveByTech.has(a.id) ? 1 : 0));
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const curPage = Math.min(page, totalPages);
  const paged = filtered.slice((curPage - 1) * perPage, curPage * perPage);

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Pianificazione tecnici</h1>
          <p>
            {rangeLabel} · {techs.length} tecnici ·{" "}
            {techs.reduce((n, t) => n + t.blocks.filter((b) => b.role !== "member").length, 0)} pianificati ·{" "}
            {live.length} on-site
          </p>
        </div>
        {canEdit && (
          <div className="flex-inline" style={{ gap: 8 }}>
            {syncMsg && <span className="muted small">{syncMsg}</span>}
            <button className="btn-ghost" onClick={syncTimbrature} disabled={syncing}>
              <Icon name="download" size={15} /> {syncing ? "Sincronizzo…" : "Sincronizza timbrature"}
            </button>
            <button className="btn-ghost" onClick={() => setShowTimbra(true)}>
              <Icon name="clock" size={15} /> Timbra (manuale)
            </button>
          </div>
        )}
      </div>

      <div className="period-bar">
        <div className="view-switch">
          {([["week", "Settimana"], ["gantt", "2 settimane"], ["month", "Mese"]] as const).map(([v, l]) => (
            <button
              key={v}
              className={"view-switch-btn" + (view === v ? " active" : "")}
              onClick={() => go(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="flex-inline" style={{ gap: 8, marginLeft: "auto" }}>
          <button className="btn-ghost-sm" onClick={() => go(view, prevDate)} title="Precedente">‹</button>
          <button className="btn-ghost-sm" onClick={() => go(view, todayIso)}>Oggi</button>
          <button className="btn-ghost-sm" onClick={() => go(view, nextDate)} title="Successivo">›</button>
          <strong style={{ fontSize: 14, minWidth: 170, textAlign: "right" }}>{rangeLabel}</strong>
        </span>
      </div>

      {view === "month" ? (
        <MonthCalendar days={monthDays} />
      ) : (
        <>
      <div className="gantt-toolbar">
        <div className="search" style={{ maxWidth: 280 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input
            placeholder="Cerca tecnico…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <span className="flex-inline" style={{ gap: 8, marginLeft: "auto" }}>
          <span className="muted small">Righe</span>
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", font: "inherit", fontSize: 13 }}
          >
            {[10, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button className="btn-ghost-sm" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>
            ‹
          </button>
          <span className="muted small mono">
            {filtered.length === 0 ? 0 : (curPage - 1) * perPage + 1}–{Math.min(curPage * perPage, filtered.length)} / {filtered.length}
          </span>
          <button className="btn-ghost-sm" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>
            ›
          </button>
        </span>
      </div>

      <div className="gantt">
        <div className="gantt-head">
          <div className="gantt-corner">Tecnico</div>
          <div className="gantt-days">
            {days.map((d) => (
              <div key={d.iso} className={"gantt-day" + (d.today ? " today" : "") + (d.weekend ? " weekend" : "")}>
                <div>{d.weekday}</div>
                <div className="num mono">{d.dayNum}</div>
                {d.showMonth && <div className="gmonth">{d.month}</div>}
              </div>
            ))}
          </div>
        </div>

        {paged.map((t) => (
          <div className="gantt-row" key={t.id}>
            <div className="gantt-tech">
              <span className="tech-avatar">{initials(t.name)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="tname" style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                {liveByTech.has(t.id) ? (
                  <span className="live-badge" title={liveByTech.get(t.id)?.customerName ?? ""}>
                    <span className="pulse" />
                    <span className="lb-text">
                      On-site{liveByTech.get(t.id)?.customerName ? ` · ${liveByTech.get(t.id)!.customerName}` : ""}
                    </span>
                  </span>
                ) : (
                  <div className="muted small tname">{t.zona ?? "—"}</div>
                )}
              </div>
              {t.conflict && <span className="conflict-dot" title="Conflitto di pianificazione" />}
            </div>
            <div
              className={"gantt-cells" + (dropTech === t.id ? " drop-target" : "")}
              onDragOver={
                canEdit
                  ? (e) => {
                      e.preventDefault();
                      if (dropTech !== t.id) setDropTech(t.id);
                    }
                  : undefined
              }
              onDragLeave={() => setDropTech((d) => (d === t.id ? null : d))}
              onDrop={canEdit ? (e) => dropOnTech(e, t.id) : undefined}
            >
              {days.map((d) => (
                <div key={d.iso} className={"gantt-cell" + (d.today ? " today" : "") + (d.weekend ? " weekend" : "")} />
              ))}
              {t.blocks.map((b) => {
                const prio = PRIORITY_META[b.priority] ?? PRIORITY_META[3];
                const isResizing = resize?.id === b.id;
                const len = isResizing ? resize!.previewLen : b.len;
                const isMember = b.role === "member";
                return (
                  <Link
                    key={b.id}
                    href={`/service/interventi/${b.id}`}
                    className={"gantt-block" + (isResizing ? " resizing" : "") + (isMember ? " member" : "")}
                    draggable={canEdit && !isResizing && !isMember}
                    onDragStart={(e) => {
                      if (isMember) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/intervento", b.id);
                    }}
                    style={{
                      left: `calc(${b.day} * ${colW} + 3px)`,
                      width: `calc(${len} * ${colW} - 6px)`,
                      background: isMember ? "transparent" : prio.color,
                      borderColor: prio.color,
                    }}
                    title={
                      isMember
                        ? `${b.code} · ${b.title} — partecipante`
                        : `${b.code} · ${b.title} (${len} ${len === 1 ? "giorno" : "giorni"})`
                    }
                  >
                    <span className="gantt-block-title">
                      {isMember ? "· " : ""}
                      {b.title}
                    </span>
                    {canEdit && !isMember && (
                      <span
                        className="gantt-block-handle"
                        title="Trascina per cambiare la durata"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const cellsEl = e.currentTarget.closest(".gantt-cells") as HTMLElement | null;
                          if (!cellsEl) return;
                          const cellW = cellsEl.getBoundingClientRect().width / days.length;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setResize({ id: b.id, day: b.day, baseLen: b.len, previewLen: b.len, cellW, startX: e.clientX });
                        }}
                        onPointerMove={(e) => {
                          if (!resize || resize.id !== b.id) return;
                          const deltaDays = Math.round((e.clientX - resize.startX) / resize.cellW);
                          const previewLen = Math.max(1, Math.min(days.length - resize.day, resize.baseLen + deltaDays));
                          if (previewLen !== resize.previewLen) setResize({ ...resize, previewLen });
                        }}
                        onPointerUp={() => {
                          if (resize && resize.id === b.id) {
                            const finalLen = resize.previewLen;
                            setResize(null);
                            if (finalLen !== b.len) setSpan(b.id, days[b.day].iso, finalLen);
                          } else {
                            setResize(null);
                          }
                        }}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state">Nessun tecnico trovato.</div>}
      </div>
        </>
      )}

      <div className="grid-two" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-header">
            <h3>Da pianificare</h3>
            <span className="muted small">{pending.length}</span>
          </div>
          <ul className="mini-list">
            {pending.map((p) => (
              <PendingRow key={p.id} item={p} allTechs={allTechs} days={days} canEdit={canEdit} />
            ))}
            {pending.length === 0 && <li className="muted small">Tutto pianificato 🎉</li>}
          </ul>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Conflitti rilevati</h3>
          </div>
          {showTimbra && (
            <TimbraModal
              allTechs={allTechs}
              onClose={() => setShowTimbra(false)}
              onDone={() => {
                setShowTimbra(false);
                loadLive();
              }}
            />
          )}
          {conflicts.length === 0 ? (
            <div className="muted small">Nessun conflitto di pianificazione.</div>
          ) : (
            <ul className="mini-list">
              {conflicts.map((t) => {
                const lead = t.blocks.filter((b) => b.role !== "member");
                const pairs: [Block, Block][] = [];
                for (let a = 0; a < lead.length; a++)
                  for (let b = a + 1; b < lead.length; b++) {
                    const A = lead[a];
                    const B = lead[b];
                    if (A.day < B.day + B.len && B.day < A.day + A.len) pairs.push([A, B]);
                  }
                const dl = (b: Block) => `${days[b.day]?.weekday ?? ""} ${days[b.day]?.dayNum ?? ""}`;
                return (
                  <li key={t.id} className="conflict-item">
                    <div className="conflict-head">
                      <Icon name="flag" size={15} color="#dc2626" />
                      <span style={{ fontWeight: 600 }}>{t.name}</span>
                    </div>
                    {pairs.map(([A, B], i) => (
                      <div key={i} className="conflict-pair">
                        <Link href={`/service/interventi/${A.id}`} className="link-strong">{A.title}</Link>{" "}
                        <span className="muted small">({dl(A)})</span>
                        <span className="muted"> ⇄ </span>
                        <Link href={`/service/interventi/${B.id}`} className="link-strong">{B.title}</Link>{" "}
                        <span className="muted small">({dl(B)})</span>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {conflict && (
        <div className="modal-backdrop" onClick={() => setConflict(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Conflitto di pianificazione</h2>
              <button className="icon-btn" onClick={() => setConflict(null)} aria-label="Chiudi">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                <strong>{conflict.techName}</strong> è già occupato <strong>{conflict.dayLabel}</strong> con{" "}
                «<strong>{conflict.other.title}</strong>» ({PRIORITY_META[conflict.other.priority]?.short}).
              </p>
              <div className="conflict-cmp">
                <div className="conflict-cmp-col">
                  <span className="field-label">Vuoi pianificare</span>
                  <span className="prio-chip" style={{ background: (PRIORITY_META[conflict.prio]?.color ?? "#64748b") + "1f", color: PRIORITY_META[conflict.prio]?.color }}>
                    {PRIORITY_META[conflict.prio]?.short}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{conflict.title}</span>
                </div>
                <div className="conflict-cmp-col">
                  <span className="field-label">Al posto di</span>
                  <span className="prio-chip" style={{ background: (PRIORITY_META[conflict.other.priority]?.color ?? "#64748b") + "1f", color: PRIORITY_META[conflict.other.priority]?.color }}>
                    {PRIORITY_META[conflict.other.priority]?.short}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{conflict.other.title}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ flexWrap: "wrap", gap: 8 }}>
              <button className="btn-ghost" onClick={() => setConflict(null)}>
                Annulla
              </button>
              <button className="btn-ghost" onClick={resolveMoveOther}>
                Sposta «{conflict.other.title}» al giorno dopo
              </button>
              <button className="btn-primary" onClick={resolveKeep}>
                Pianifica comunque (priorità a questo)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthCalendar({ days }: { days: MonthDay[] }) {
  const weekdays = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
  return (
    <div className="mcal">
      <div className="mcal-head">
        {weekdays.map((w) => (
          <div key={w} className="mcal-hcell">
            {w}
          </div>
        ))}
      </div>
      <div className="mcal-grid">
        {days.map((d) => (
          <div
            key={d.iso}
            className={
              "mcal-cell" +
              (d.inMonth ? "" : " out") +
              (d.today ? " today" : "") +
              (d.weekend ? " weekend" : "")
            }
          >
            <div className="mcal-daynum">
              {d.dayNum}
              {d.dayNum === 1 && <span className="mcal-mon"> {d.month}</span>}
            </div>
            <div className="mcal-items">
              {d.items.slice(0, 4).map((it, i) => {
                const prio = PRIORITY_META[it.priority] ?? PRIORITY_META[3];
                return (
                  <Link
                    key={it.id + "-" + i}
                    href={`/service/interventi/${it.id}`}
                    className="mcal-item"
                    style={{ borderLeftColor: prio.color }}
                    title={`${it.title}${it.tech ? " · " + it.tech : ""}`}
                  >
                    <span className="mcal-item-title">{it.title}</span>
                    {it.tech && <span className="mcal-item-tech">{initials(it.tech)}</span>}
                  </Link>
                );
              })}
              {d.items.length > 4 && <span className="muted small">+{d.items.length - 4} altri</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingRow({
  item,
  allTechs,
  days,
  canEdit,
}: {
  item: PendingItem;
  allTechs: Tech[];
  days: GanttDay[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const prio = PRIORITY_META[item.priority] ?? PRIORITY_META[3];
  const [open, setOpen] = useState(false);
  const [tech, setTech] = useState(item.assignedTechId ?? "");
  const [day, setDay] = useState(days[0]?.iso ?? "");
  const [dur, setDur] = useState(1);
  const [busy, setBusy] = useState(false);

  async function plan() {
    if (!tech || !day) return;
    setBusy(true);
    try {
      const start = new Date(`${day}T09:00:00`);
      const end = new Date(start);
      end.setDate(start.getDate() + (dur - 1));
      end.setHours(18, 0, 0, 0);
      await fetch(`/api/interventi/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedTechId: tech,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          status: "PIANIFICATO",
        }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div
        className={"mini-row" + (canEdit ? " draggable" : "")}
        style={{ cursor: canEdit ? "pointer" : "default" }}
        onClick={() => canEdit && setOpen((o) => !o)}
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/intervento", item.id);
        }}
        title={canEdit ? "Trascina su un tecnico per pianificare, o clicca per assegnare" : undefined}
      >
        <span className="prio-chip" style={{ background: prio.color + "1f", color: prio.color }}>{prio.short}</span>
        <span style={{ flex: 1, fontWeight: 600 }}>{item.title}</span>
        <span className="muted small">{item.customer ?? ""}</span>
        {canEdit && <Icon name={open ? "chev-down" : "chev-right"} size={14} />}
      </div>
      {open && canEdit && (
        <div className="plan-box">
          <select value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">— Tecnico —</option>
            {allTechs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d.iso} value={d.iso}>
                {d.weekday} {d.dayNum} {d.month}
              </option>
            ))}
          </select>
          <select value={dur} onChange={(e) => setDur(Number(e.target.value))} title="Durata in giorni">
            {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "giorno" : "giorni"}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={plan} disabled={busy || !tech}>
            {busy ? "…" : "Pianifica"}
          </button>
        </div>
      )}
    </li>
  );
}

function TimbraModal({
  allTechs,
  onClose,
  onDone,
}: {
  allTechs: Tech[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [commessa, setCommessa] = useState("");
  const [event, setEvent] = useState<"in" | "out">("in");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!userId) {
      setErr("Seleziona il tecnico.");
      return;
    }
    if (event === "in" && !commessa.trim()) {
      setErr("Inserisci la commessa (job) su cui timbrare.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, commessa: commessa.trim() || undefined, event }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErr(d?.error ?? "Errore.");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Timbratura manuale</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Tecnico *</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} autoFocus>
              <option value="">— Seleziona —</option>
              {allTechs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.zona ? ` · ${t.zona}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Evento</span>
            <select value={event} onChange={(e) => setEvent(e.target.value as "in" | "out")}>
              <option value="in">Entrata (on-site)</option>
              <option value="out">Uscita</option>
            </select>
          </label>
          {event === "in" && (
            <label className="field">
              <span className="field-label">Commessa (job)</span>
              <input
                value={commessa}
                onChange={(e) => setCommessa(e.target.value)}
                placeholder="Es. 1260112 — il cantiere si ricava dalla commessa"
              />
            </label>
          )}
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "…" : event === "in" ? "Timbra entrata" : "Timbra uscita"}
          </button>
        </div>
      </div>
    </div>
  );
}
