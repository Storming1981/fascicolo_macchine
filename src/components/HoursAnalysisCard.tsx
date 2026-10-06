"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { fmtDate, fmtDateTime, fmtHM } from "@/lib/format";
import type { HoursAnalysis, SiteLink } from "@/lib/hoursAnalysis";

/**
 * Ore e dati gestionale di un fascicolo, in una card sola: produzione
 * (commesse e ordini del gestionale, avanzamenti `avlavp`) + cantiere
 * (timbrature del timbratore esterno, lavoro e viaggio).
 *
 * Prima erano due card ("Dati gestionale (ERP)" e "Analisi ore") che ripetevano
 * le stesse ore in due posti: qui restano le commesse, la scelta dell'ordine di
 * produzione e «Applica date», che la card gestionale aveva di suo.
 */

const LINK_LABEL: Record<SiteLink, string> = {
  job: "Job",
  cantiere: "Commessa cantiere",
  intervento: "Intervento",
  descrizione: "Citato nella descrizione",
};
const LINK_HINT: Record<SiteLink, string> = {
  job: "Timbrato direttamente sul job del fascicolo",
  cantiere: "Job + 2 cifre (es. installazione)",
  intervento: "Commessa di un intervento di service collegato al fascicolo",
  descrizione: "Il job del fascicolo compare nel nome della commessa: legame dedotto, da verificare",
};
const SOURCE_LABEL: Record<NonNullable<HoursAnalysis["production"]["source"]>, string> = {
  erp: "gestionale in diretta",
  snapshot: "gestionale (ultimo sync)",
  saved: "ore salvate sul fascicolo",
};

const GENERIC_COMMESSA = "999999999"; // commessa generica impianti nuovi
const isGeneric = (v: string | null | undefined) => !!v && String(v).trim() === GENERIC_COMMESSA;

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const fmtMonth = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
const h = (n: number) => (n > 0 ? fmtHM(n) : "—");

type Month = HoursAnalysis["site"]["months"][number];
function fillMonths(src: Month[]): Month[] {
  if (src.length === 0) return [];
  const by = new Map(src.map((m) => [m.month, m]));
  const out: Month[] = [];
  let [y, mo] = src[0].month.split("-").map(Number);
  const end = src[src.length - 1].month;
  for (let i = 0; i < 120; i++) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    out.push(by.get(key) ?? { month: key, work: 0, travel: 0, other: 0 });
    if (key === end) break;
    if (++mo > 12) {
      mo = 1;
      y++;
    }
  }
  return out;
}

export type HoursMachine = {
  id: string;
  job: string | null;
  jobBody: string | null;
  jobContainer: string | null;
  erpBodyOrder: string | null;
  erpContainerOrder: string | null;
  erpStandOrder: string | null;
  erpBladesOrder: string | null;
  erpSyncedAt: string | null;
};

export default function HoursAnalysisCard({
  machine,
  canEdit,
  onDone,
  notify,
}: {
  machine: HoursMachine;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [data, setData] = useState<HoursAnalysis | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showOps, setShowOps] = useState(false);

  async function load(method: "GET" | "POST" = "GET") {
    if (method === "POST") setRefreshing(true);
    else setState("loading");
    try {
      const res = await fetch(`/api/machines/${machine.id}/hours`, { method });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Errore lettura ore");
      setData(d);
      setState("ok");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore lettura ore");
      if (method === "GET") setState("error");
    } finally {
      setRefreshing(false);
    }
  }

  // si ricarica al cambio job e alla scelta di un ordine di produzione
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    machine.id,
    machine.job,
    machine.jobBody,
    machine.jobContainer,
    machine.erpBodyOrder,
    machine.erpContainerOrder,
    machine.erpStandOrder,
    machine.erpBladesOrder,
  ]);

  async function applyDates() {
    setApplying(true);
    const res = await fetch(`/api/machines/${machine.id}/erp-sync`, { method: "POST" });
    setApplying(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      notify("Date di produzione importate dal gestionale");
      onDone();
    } else {
      notify(d.error || "Errore importazione", "err");
    }
  }

  const p = data?.production;
  const s = data?.site;
  const total = data?.total ?? 0;
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0");
  // mesi continui dal primo all'ultimo: un buco fra installazione e service
  // deve vedersi, altrimenti dicembre e maggio sembrano mesi consecutivi
  const months = fillMonths(s?.months ?? []);
  const monthMax = Math.max(1, ...months.map((m) => m.work + m.travel + m.other));

  // Fascicolo appena creato e gestionale ancora muto: non è un errore, è il
  // sync-agent che non è ancora passato. Senza avviso sembra un dato mancante.
  const createdAt = data?.machineCreatedAt ? new Date(data.machineCreatedAt) : null;
  const waitingFirstSync =
    !!p &&
    p.source !== "erp" &&
    p.commesse.length === 0 &&
    p.total === 0 &&
    !machine.erpSyncedAt &&
    !!createdAt &&
    Date.now() - createdAt.getTime() < 3 * 86400_000;

  return (
    <section className="card">
      <div className="card-header">
        <h3>Analisi ore</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn-ghost-sm" onClick={() => load("POST")} disabled={refreshing || state === "loading"}>
            <Icon name="clock" size={13} /> {refreshing ? "Aggiorno…" : "Aggiorna"}
          </button>
          {canEdit && p?.hasProduction && (
            <button className="btn-primary-sm" disabled={applying} onClick={applyDates}>
              <Icon name="check" size={13} /> Applica date
            </button>
          )}
        </div>
      </div>

      {state === "loading" && <p className="muted small">Calcolo ore…</p>}
      {state === "error" && <p className="muted small">{err}</p>}

      {state === "ok" && p && s && (
        <>
          {err && (
            <p className="muted small" style={{ color: "var(--red)" }}>
              {err}
            </p>
          )}

          {waitingFirstSync && (
            <div className="info-banner" style={{ marginBottom: 12 }}>
              <Icon name="clock" size={15} />
              <span>
                Fascicolo creato il {fmtDateTime(data.machineCreatedAt)}: i dati del gestionale (ore di
                produzione e date) arrivano col prossimo passaggio del sync-agent.
              </span>
            </div>
          )}

          <div className="hours-kpis">
            <div className="hours-kpi">
              <div className="hours-kpi-label">Totale</div>
              <div className="hours-kpi-value">{h(total)}</div>
              <div className="hours-kpi-sub">produzione + cantiere</div>
            </div>
            <div className="hours-kpi">
              <div className="hours-kpi-label">
                <span className="hours-dot prod" /> Produzione
              </div>
              <div className="hours-kpi-value">{h(p.total)}</div>
              <div className="hours-kpi-sub">
                {p.start ? `${fmtDate(p.start)} → ${p.end ? fmtDate(p.end) : "in corso"}` : "nessuna timbratura"}
              </div>
            </div>
            <div className="hours-kpi">
              <div className="hours-kpi-label">
                <span className="hours-dot work" /> Cantiere · lavoro
              </div>
              <div className="hours-kpi-value">{h(s.work + s.other)}</div>
              <div className="hours-kpi-sub">
                {s.first ? `${fmtDate(s.first)} → ${fmtDate(s.last)}` : "nessuna timbratura"}
              </div>
            </div>
            <div className="hours-kpi">
              <div className="hours-kpi-label">
                <span className="hours-dot travel" /> Cantiere · viaggio
              </div>
              <div className="hours-kpi-value">{h(s.travel)}</div>
              <div className="hours-kpi-sub">
                {s.total > 0 ? `${Math.round((s.travel / s.total) * 100)}% delle ore di cantiere` : "—"}
              </div>
            </div>
          </div>

          {total > 0 && (
            <div className="hours-bar" role="img" aria-label="Ripartizione delle ore">
              {p.total > 0 && <div className="hours-seg prod" style={{ width: pct(p.total) }} title={`Produzione ${fmtHM(p.total)}`} />}
              {s.work > 0 && <div className="hours-seg work" style={{ width: pct(s.work) }} title={`Cantiere lavoro ${fmtHM(s.work)}`} />}
              {s.other > 0 && <div className="hours-seg other" style={{ width: pct(s.other) }} title={`Cantiere altro ${fmtHM(s.other)}`} />}
              {s.travel > 0 && <div className="hours-seg travel" style={{ width: pct(s.travel) }} title={`Viaggio ${fmtHM(s.travel)}`} />}
            </div>
          )}

          {/* Produzione: le commesse del fascicolo come le vede il gestionale */}
          <div className="hours-sub">
            Produzione · {p.source ? SOURCE_LABEL[p.source] : "nessun dato dal gestionale"}
            {p.source === "snapshot" && machine.erpSyncedAt && ` · ${fmtDateTime(machine.erpSyncedAt)}`}
          </div>
          {p.commesse.length > 0 ? (
            <div className="table-wrap">
              <table className="erp-jobs hours-table">
                <thead>
                  <tr>
                    <th>Commessa</th>
                    <th>Ruolo</th>
                    <th>Descrizione</th>
                    <th>Cliente</th>
                    <th>Aperta</th>
                    <th style={{ textAlign: "right" }}>Timbr.</th>
                    <th style={{ textAlign: "right" }}>Ore</th>
                  </tr>
                </thead>
                <tbody>
                  {p.commesse.map((c) => (
                    <tr key={c.job} style={c.found ? undefined : { opacity: 0.55 }}>
                      <td className="mono">{c.job}</td>
                      <td>{c.role}</td>
                      <td>
                        {c.found ? c.description || "—" : <span className="muted">non trovata nel gestionale</span>}
                      </td>
                      <td>{c.customer || "—"}</td>
                      <td className="mono">{c.openedAt ? fmtDate(c.openedAt) : "—"}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {c.found ? c.progressRows || 0 : "—"}
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                        {c.found ? h(c.hours) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {p.total > 0
                ? `Ore salvate sul fascicolo: ${h(p.total)} (dettaglio per commessa non disponibile).`
                : waitingFirstSync
                  ? "In attesa del primo passaggio del sync-agent."
                  : "Nessun dato dal gestionale per i job di questo fascicolo."}
            </p>
          )}

          {/* Ordini di produzione: per gli impianti nuovi la commessa è la
              generica 999999999 e le ore stanno sull'ORDINE, non sulla commessa */}
          {(isGeneric(machine.jobBody) || isGeneric(machine.jobContainer)) && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small" style={{ fontWeight: 600, marginBottom: 6 }}>
                Ordini di produzione (impianto nuovo, commessa {GENERIC_COMMESSA})
              </div>
              {isGeneric(machine.jobBody) && (
                <OrderPicker machineId={machine.id} role="Corpo" field="erpBodyOrder" currentKey={machine.erpBodyOrder} canEdit={canEdit} onDone={onDone} notify={notify} />
              )}
              {isGeneric(machine.jobContainer) && (
                <OrderPicker machineId={machine.id} role="Container" field="erpContainerOrder" currentKey={machine.erpContainerOrder} canEdit={canEdit} onDone={onDone} notify={notify} />
              )}
              <OrderPicker machineId={machine.id} role="Cavalletto" field="erpStandOrder" currentKey={machine.erpStandOrder} canEdit={canEdit} onDone={onDone} notify={notify} />
              <OrderPicker machineId={machine.id} role="Lame" field="erpBladesOrder" currentKey={machine.erpBladesOrder} canEdit={canEdit} onDone={onDone} notify={notify} />
            </div>
          )}

          {/* Articoli degli ordini selezionati */}
          {p.orders.map((o) => (
            <div key={o.role + o.key} style={{ marginTop: 12 }}>
              <div className="muted small" style={{ fontWeight: 600 }}>
                Articoli ordine {o.role} — {o.tipork}/{o.anno}/{o.num} · {h(o.hours)} ·{" "}
                {o.start ? fmtDate(o.start) : "—"} → {o.end ? fmtDate(o.end) : "—"}
              </div>
              <div className="table-wrap">
                <table className="erp-jobs hours-table">
                  <thead>
                    <tr>
                      <th>Articolo</th>
                      <th>Descrizione</th>
                      <th style={{ textAlign: "right" }}>Timbr.</th>
                      <th style={{ textAlign: "right" }}>Ore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.articles.map((a) => (
                      <tr key={(a.code || "") + (a.desc || "")}>
                        <td className="mono">{a.code || "—"}</td>
                        <td>{a.desc || "—"}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{a.rows}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{h(a.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Cantiere: commesse del timbratore agganciate al fascicolo */}
          <div className="hours-sub">Cantiere · timbratore</div>
          {s.commesse.length === 0 ? (
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {data.feedConfigured
                ? "Nessuna timbratura di cantiere sulle commesse di questo fascicolo."
                : "Timbratore non configurato su questo server."}
            </p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="erp-jobs hours-table">
                  <thead>
                    <tr>
                      <th>Commessa</th>
                      <th>Descrizione</th>
                      <th>Legame</th>
                      <th>Periodo</th>
                      <th style={{ textAlign: "right" }}>Lavoro</th>
                      <th style={{ textAlign: "right" }}>Viaggio</th>
                      <th style={{ textAlign: "right" }}>Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.commesse.map((c) => (
                      <tr key={c.code}>
                        <td className="mono">{c.code}</td>
                        <td>
                          {c.description || "—"}
                          <div className="muted small">
                            {c.operators} {c.operators === 1 ? "operatore" : "operatori"} · {c.stampings} timbrature
                            {c.open > 0 && ` · ${c.open} aperte`}
                          </div>
                        </td>
                        <td>
                          <span className={`hours-link ${c.link}`} title={LINK_HINT[c.link]}>
                            {LINK_LABEL[c.link]}
                          </span>
                          {c.ref && <div className="muted small">{c.ref}</div>}
                        </td>
                        <td className="mono small">
                          {fmtDate(c.first)}
                          {c.last && c.last.slice(0, 10) !== c.first?.slice(0, 10) && <> → {fmtDate(c.last)}</>}
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>{h(c.work + c.other)}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{h(c.travel)}</td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>{h(c.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {months.length > 1 && (
                <>
                  <div className="hours-sub">Ore di cantiere per mese</div>
                  <div className="hours-months">
                    {months.map((m) => (
                      <div
                        key={m.month}
                        className="hours-month"
                        title={`${fmtMonth(m.month)} — lavoro ${h(m.work + m.other)}, viaggio ${h(m.travel)}`}
                      >
                        <div className="hours-seg work" style={{ height: `${((m.work + m.other) / monthMax) * 100}%` }} />
                        <div className="hours-seg travel" style={{ height: `${(m.travel / monthMax) * 100}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="hours-months-axis">
                    <span>{fmtMonth(months[0].month)}</span>
                    <span>{fmtMonth(months[months.length - 1].month)}</span>
                  </div>
                </>
              )}

              <div className="hours-sub" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Operatori in cantiere ({s.operators.length})</span>
                <button className="btn-ghost-sm" onClick={() => setShowOps((v) => !v)}>
                  {showOps ? "Nascondi" : "Mostra"}
                </button>
              </div>
              {showOps && (
                <div className="table-wrap">
                  <table className="erp-jobs hours-table">
                    <thead>
                      <tr>
                        <th>Operatore</th>
                        <th style={{ textAlign: "right" }}>Lavoro</th>
                        <th style={{ textAlign: "right" }}>Viaggio</th>
                        <th style={{ textAlign: "right" }}>Totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.operators.map((o) => (
                        <tr key={o.matricola || o.name}>
                          <td>
                            {o.name}
                            {o.matricola && <span className="muted small"> · {o.matricola}</span>}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>{h(o.hours - o.travel)}</td>
                          <td className="mono" style={{ textAlign: "right" }}>{h(o.travel)}</td>
                          <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>{h(o.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <p className="muted small" style={{ marginTop: 10 }}>
            Produzione = ore di lavorazione del gestionale (<span className="mono">avlavp</span>): inizio e fine sono
            la prima e l&apos;ultima timbratura, e <em>Applica date</em> le riporta sulle date di stato del diario.
            Cantiere = timbrature del timbratore sul job, sulle commesse job + 2 cifre, sugli interventi di service
            del fascicolo e sulle commesse che citano il job nel nome.
            {data.syncedAt && ` Timbrature aggiornate al ${fmtDateTime(data.syncedAt)}.`}
          </p>
        </>
      )}
    </section>
  );
}

/* ── Selettore ordine di produzione di una commessa ─────── */

type ErpOrderOption = {
  key: string;
  tipork: string;
  anno: number;
  num: number;
  mainArticleCode: string | null;
  mainArticleDesc: string | null;
  hours: number;
};

function OrderPicker({
  machineId,
  role,
  field,
  currentKey,
  canEdit,
  onDone,
  notify,
}: {
  machineId: string;
  role: string;
  field: "erpBodyOrder" | "erpContainerOrder" | "erpStandOrder" | "erpBladesOrder";
  currentKey: string | null;
  canEdit: boolean;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [orders, setOrders] = useState<ErpOrderOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/erp/commessa/${GENERIC_COMMESSA}/orders`)
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d) => {
        if (alive) setOrders(d.orders ?? []);
      })
      .catch(() => alive && setOrders([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  async function select(key: string) {
    setSaving(true);
    const res = await fetch(`/api/machines/${machineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: key }),
    });
    setSaving(false);
    if (res.ok) {
      notify(key ? `Ordine ${role} selezionato` : `Ordine ${role} rimosso`);
      onDone();
    } else {
      notify("Errore salvataggio ordine", "err");
    }
  }

  return (
    <div className="erp-order-row">
      <label className="muted small" style={{ minWidth: 90 }}>
        Ordine {role}
      </label>
      <select
        className="input"
        disabled={!canEdit || saving || loading}
        value={currentKey ?? ""}
        onChange={(e) => select(e.target.value)}
      >
        <option value="">
          {loading ? "Caricamento…" : `— nessun ordine (${(orders ?? []).length} disponibili)`}
        </option>
        {(orders ?? []).map((o) => (
          <option key={o.key} value={o.key}>
            {o.tipork}/{o.anno}/{o.num} · {o.mainArticleDesc || o.mainArticleCode || "?"} ·{" "}
            {o.hours.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h
          </option>
        ))}
      </select>
    </div>
  );
}
