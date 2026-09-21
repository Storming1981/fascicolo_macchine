"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { fmtDate, fmtDateTime, fmtHM } from "@/lib/format";
import type { HoursAnalysis, SiteLink } from "@/lib/hoursAnalysis";

/**
 * Analisi ore del fascicolo: produzione (gestionale) + cantiere (timbratore).
 * Le due fonti non si sovrappongono: il gestionale timbra le lavorazioni in
 * officina, il timbratore le trasferte e i lavori dal cliente.
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

export default function HoursAnalysisCard({ machineId, jobsKey }: { machineId: string; jobsKey: string }) {
  const [data, setData] = useState<HoursAnalysis | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showOps, setShowOps] = useState(false);

  async function load(method: "GET" | "POST" = "GET") {
    if (method === "POST") setRefreshing(true);
    else setState("loading");
    try {
      const res = await fetch(`/api/machines/${machineId}/hours`, { method });
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, jobsKey]);

  const p = data?.production;
  const s = data?.site;
  const total = data?.total ?? 0;
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0");
  // mesi continui dal primo all'ultimo: un buco fra installazione e service
  // deve vedersi, altrimenti dicembre e maggio sembrano mesi consecutivi
  const months = fillMonths(s?.months ?? []);
  const monthMax = Math.max(1, ...months.map((m) => m.work + m.travel + m.other));

  return (
    <section className="card">
      <div className="card-header">
        <h3>Analisi ore</h3>
        {data?.feedConfigured && (
          <button className="btn-ghost-sm" onClick={() => load("POST")} disabled={refreshing || state === "loading"}>
            <Icon name="clock" size={13} /> {refreshing ? "Lettura timbratore…" : "Aggiorna dal timbratore"}
          </button>
        )}
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

          {/* Produzione: da dove vengono le ore del gestionale */}
          <div className="hours-sub">Produzione · {p.source ? SOURCE_LABEL[p.source] : "nessun dato dal gestionale"}</div>
          {p.parts.length > 0 ? (
            <div className="table-wrap">
              <table className="erp-jobs hours-table">
                <thead>
                  <tr>
                    <th>Parte</th>
                    <th>Commessa / Ordine</th>
                    <th style={{ textAlign: "right" }}>Ore</th>
                  </tr>
                </thead>
                <tbody>
                  {p.parts.map((x) => (
                    <tr key={x.label + x.code}>
                      <td>{x.label}</td>
                      <td className="mono">{x.code}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{h(x.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {p.total > 0 ? "Dettaglio per commessa non disponibile." : "Nessuna ora di produzione registrata."}
            </p>
          )}

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
            Produzione = ore di lavorazione del gestionale (<span className="mono">avlavp</span>). Cantiere = timbrature
            del timbratore sul job, sulle commesse job + 2 cifre, sugli interventi di service del fascicolo e sulle
            commesse che citano il job nel nome.
            {data.syncedAt && ` Timbrature aggiornate al ${fmtDateTime(data.syncedAt)}.`}
          </p>
        </>
      )}
    </section>
  );
}
