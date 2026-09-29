"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { TecnicoDocsDto } from "@/lib/tecniciDocs";

/* ── Documenti dei tecnici dal fascicolo TeamSystem ────────────
   Un operatore per riga (capo cantiere in testa); aprendolo si vedono le sue
   cartelle — Corsi e attestati (con lo storico corsi della formazione),
   Idoneità, DPI, Nomine, Coperture. Si carica dopo la scheda: TeamSystem
   risponde in qualche secondo e non deve rallentare l'apertura
   dell'intervento. */

type Data = { configured: boolean; team: TecnicoDocsDto[] };

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function TecniciDocs({ interventoId }: { interventoId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/interventi/${interventoId}/tecnici-docs${refresh ? "?refresh=1" : ""}`);
        const d = await res.json().catch(() => null);
        if (!res.ok) throw new Error(d?.error ?? "Errore nel caricamento");
        setData(d);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore nel caricamento");
      } finally {
        setLoading(false);
      }
    },
    [interventoId]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="field" style={{ marginTop: 14 }}>
      <div className="tdocs-head">
        <span className="field-label">Documenti dei tecnici (fascicolo TeamSystem)</span>
        {data?.configured && data.team.length > 0 && (
          <button className="btn-ghost-sm" onClick={() => load(true)} disabled={loading}>
            <Icon name="clock" size={13} /> {loading ? "Lettura…" : "Aggiorna"}
          </button>
        )}
      </div>

      {err && <div className="form-error">{err}</div>}
      {!data && loading && <div className="muted small">Lettura del fascicolo TeamSystem…</div>}

      {data && !data.configured && (
        <div className="muted small">
          TeamSystem HR non configurato: mancano le credenziali (TEAMSYSTEM_HR_*) nel file .env del server.
        </div>
      )}
      {data?.configured && data.team.length === 0 && (
        <div className="muted small">
          Nessun tecnico assegnato: i documenti compaiono quando si assegnano capo cantiere e squadra.
        </div>
      )}

      {data?.configured && data.team.length > 0 && (
        <ul className="tdocs-list">
          {data.team.map((t) => {
            const isOpen = open === t.userId;
            const attestati = t.folders.find((f) => f.key === "attestati")?.docs.length ?? 0;
            const idoneita = (t.folders.find((f) => f.key === "idoneita")?.docs.length ?? 0) > 0;
            return (
              <li key={t.userId} className={`tdocs-person${isOpen ? " open" : ""}`}>
                <button className="tdocs-row" onClick={() => setOpen(isOpen ? null : t.userId)}>
                  <span className="tdocs-avatar">{initials(t.name)}</span>
                  <span className="tdocs-name">
                    {t.name}
                    {t.role === "lead" && <span className="muted small"> · capo cantiere</span>}
                  </span>
                  {t.linked ? (
                    <span className="tdocs-summary">
                      <span className="tdocs-badge">{attestati} attestati</span>
                      <span className="tdocs-badge">{t.courses.length} corsi</span>
                      <span className={`tdocs-badge ${idoneita ? "ok" : "warn"}`}>
                        {idoneita ? "idoneità" : "idoneità assente"}
                      </span>
                    </span>
                  ) : (
                    <span className="tdocs-badge warn">non collegato</span>
                  )}
                  <Icon name={isOpen ? "chev-down" : "chev-right"} size={15} color="var(--muted)" />
                </button>

                {isOpen && <PersonFolders t={t} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PersonFolders({ t }: { t: TecnicoDocsDto }) {
  const [folder, setFolder] = useState<string>("attestati");

  if (!t.linked)
    return (
      <div className="tdocs-body muted small">
        Dipendente non trovato su TeamSystem HR: il nome o la matricola in <b>Persone</b> non corrispondono
        all&apos;anagrafica TeamSystem. Correggili lì e riapri la scheda.
      </div>
    );

  const current = t.folders.find((f) => f.key === folder) ?? t.folders[0];
  return (
    <div className="tdocs-body">
      {t.error && <div className="form-error small">{t.error}</div>}
      <div className="tdocs-folders">
        {t.folders.map((f) => {
          const n = f.docs.length + (f.key === "attestati" ? t.courses.length : 0);
          return (
            <button
              key={f.key}
              className={`tdocs-folder${f.key === current.key ? " active" : ""}${n ? "" : " empty"}`}
              onClick={() => setFolder(f.key)}
            >
              <Icon name="folder" size={14} />
              <span>{f.label}</span>
              <span className="folder-count">{n}</span>
            </button>
          );
        })}
      </div>

      {current.docs.length > 0 ? (
        <ul className="doc-list tdocs-files">
          {current.docs.map((d) => (
            <li key={d.id} className="doc-row">
              <Icon name="doc" size={16} color="var(--muted)" />
              <a href={`/api/teamsystem/docs/${d.id}`} target="_blank" rel="noreferrer" className="doc-name">
                {d.title}
              </a>
              <span style={{ flex: 1 }} />
              {d.uploadedAt && <span className="muted small">{fmtDate(d.uploadedAt)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted small" style={{ padding: "6px 2px" }}>
          Nessun documento in questa cartella.
        </div>
      )}

      {current.key === "attestati" && t.courses.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>
            Corsi registrati in TeamSystem
          </div>
          <div className="tdocs-courses">
            {t.courses.map((c, i) => (
              <div key={`${c.code}-${i}`} className="tdocs-course">
                <span className="tdocs-course-name">{c.name || c.code}</span>
                <span className="muted small">
                  {[c.area, c.end ? fmtDate(`${c.end}T00:00:00`) : c.start ? fmtDate(`${c.start}T00:00:00`) : null, c.hours ? `${c.hours} h` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {t.syncedAt && <div className="muted small tdocs-sync">Letto da TeamSystem il {fmtDateTime(t.syncedAt)}</div>}
    </div>
  );
}
