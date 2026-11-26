"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { Flag } from "@/components/Icon";
import { STATUS_META, STATUS_ORDER } from "@/lib/domain";
import { hasKit, KITS } from "@/lib/kits";
import { containerType } from "@/lib/allestimento";
import type { MachineAlert, SheetsScope } from "@/lib/machineAlerts";
import type { MachineStatus } from "@prisma/client";

type M = {
  id: string;
  code: string;
  job: string;
  plantType: string | null;
  model: string;
  customer: string;
  country: string;
  countryCode: string;
  year: number;
  status: MachineStatus;
  progress: number;
  tiranteGiunto: boolean;
  filtroMaggiorato: boolean;
  /** Schede comprese nel fascicolo: un kit vive sulla sua scheda. */
  sheetKinds: string[];
  /** Quali schede comprende il fascicolo (corpo + container, o una sola). */
  scope: SheetsScope;
  /** Semafori: schede di allestimento firmate · collaudo chiuso · documenti albero. */
  schede: MachineAlert;
  collaudo: MachineAlert;
  docAlberi: MachineAlert;
  /** Tipo container dalla scheda M5.17 (null = scheda non ancora compilata). */
  containerType: string | null;
  /** Ordini di produzione agganciati (ruolo, H/2026/691, articolo, ore). */
  orders: { role: string; ref: string; desc: string | null; hours: number | null }[];
};

/** Riga sotto il puntatore: la scheda degli ordini si appoggia al suo rettangolo. */
type Peek = { m: M; top: number; bottom: number; left: number };

export default function MachinesList({
  machines,
  canCreate,
  canImport,
  initialQuery = "",
}: {
  machines: M[];
  canCreate: boolean;
  canImport: boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  // Ordini di produzione della riga sotto il puntatore: si leggono senza
  // aprire il fascicolo, che era il giro lungo per un numero solo.
  const [peek, setPeek] = useState<Peek | null>(null);
  // L elenco si apre sulle macchine IN PRODUZIONE: e il quadro che serve ogni
  // giorno (a che punto siamo). Arrivando da una ricerca si parte da "tutte",
  // altrimenti una macchina gia spedita non si troverebbe.
  const [filter, setFilter] = useState<string>(initialQuery ? "all" : "PRODUCTION");
  // Quante righe si vedono per volta. Duecento fascicoli in una pagina sola
  // vogliono dire scorrere per leggere, e la riga che serve finisce sempre
  // fuori schermo. La scelta resta sul browser di chi guarda: chi lavora su
  // dieci righe per volta non vuole rimetterlo a ogni apertura.
  const [perPage, setPerPage] = useState(PER_PAGE_DEFAULT);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(PER_PAGE_KEY));
      if (PER_PAGE.includes(v)) setPerPage(v);
    } catch {
      /* storage negato (navigazione privata): si resta sul valore di partenza */
    }
  }, []);

  const filtered = useMemo(
    () =>
      machines.filter((m) => {
        if (filter !== "all" && m.status !== filter) return false;
        if (!q) return true;
        // Si cerca anche per **ordine di produzione**: in officina una
        // macchina la si chiama col numero dell'ordine, e prima "624" non
        // trovava niente. Dentro anche l'articolo principale.
        const hay = [
          m.code,
          m.job,
          m.customer,
          m.country,
          m.model,
          m.plantType || "",
          ...m.orders.flatMap((o) => [o.ref, o.desc ?? ""]),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q.toLowerCase());
      }),
    [machines, q, filter]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  // La pagina corrente si **ricava**, non si corregge con un effetto: dopo una
  // ricerca che lascia tre risultati, "pagina 7" non esiste piu'.
  const curPage = Math.min(page, totalPages);
  const paged = filtered.slice((curPage - 1) * perPage, curPage * perPage);

  function go(p: number) {
    setPage(Math.min(Math.max(1, p), totalPages));
    setPeek(null); // la scheda degli ordini e' della riga di prima
    // A cento righe per pagina il pulsante "avanti" sta in fondo: senza
    // questo si arriva alla pagina nuova gia' in fondo all'elenco.
    tableRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function setRows(n: number) {
    setPerPage(n);
    setPage(1);
    try {
      localStorage.setItem(PER_PAGE_KEY, String(n));
    } catch {
      /* niente storage: vale per questa sessione */
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Macchine</h1>
          <p>
            {machines.length} fascicoli · dalla genesi alla rottamazione
          </p>
        </div>
        <div className="row-actions">
          {canImport && (
            <Link className="btn-ghost" href="/import">
              <Icon name="upload" size={15} /> Import
            </Link>
          )}
          {canCreate && (
            <Link className="btn-primary" href="/macchine/nuova">
              <Icon name="plus" size={15} /> Nuova macchina
            </Link>
          )}
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search" style={{ flex: 1, minWidth: 220 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input
            placeholder="Cerca commessa, ordine, cliente, paese…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="filters">
          <button
            className={"chip-btn" + (filter === "all" ? " active" : "")}
            onClick={() => {
              setFilter("all");
              setPage(1);
            }}
          >
            Tutte
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={"chip-btn" + (filter === s ? " active" : "")}
              onClick={() => {
                setFilter(s);
                setPage(1);
              }}
            >
              <span className="badge-dot" style={{ background: STATUS_META[s].color }} />
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      <div className="card no-pad" ref={tableRef}>
        <div className="table-wrap">
          <table className="data-table machines-table">
            <thead>
              <tr>
                {/* La commessa è il riferimento con cui si parla di una macchina in
                    azienda: sta in testa, e l'ID fascicolo resta nella scheda. */}
                <th>Commessa</th>
                <th>Tipologia</th>
                <th>Modello</th>
                <th title="Quali schede di allestimento comprende la commessa">Schede incluse</th>
                <th title="Tipo container dalla scheda di allestimento M5.17">Tipo container</th>
                {KITS.map((k) => (
                  <th key={k.key} title={k.hint}>
                    {k.column}
                  </th>
                ))}
                <th>Cliente</th>
                <th>Paese</th>
                <th>Anno</th>
                <th>Stato</th>
                <th>Avanzamento</th>
                <th title="Schede di allestimento: rosso finché non sono tutte firmate">Schede</th>
                <th title="Collaudo: rosso finché check list e firme non sono complete">Collaudo</th>
                <th title="Collaudo dimensionale e rilievo alberi allegati al fascicolo">Doc. alberi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paged.map((m) => {
                const ct = containerType(m.containerType);
                return (
                <tr
                  key={m.id}
                  className="clickable"
                  // Colore di riga per tipo container: in un elenco di 195
                  // fascicoli quasi uguali e' l'unico modo per distinguerli
                  // senza leggere riga per riga.
                  style={ct ? { borderLeft: `4px solid ${ct.color}`, background: `${ct.color}0d` } : undefined}
                  onClick={() => router.push(`/macchine/${m.code}`)}
                  onMouseEnter={(e) => {
                    if (!m.orders.length) return setPeek(null);
                    const r = e.currentTarget.getBoundingClientRect();
                    setPeek({ m, top: r.top, bottom: r.bottom, left: r.left });
                  }}
                  onMouseLeave={() => setPeek((pk) => (pk?.m.id === m.id ? null : pk))}
                >
                  <td className="mono">{m.job}</td>
                  <td>{m.plantType || <span className="muted">—</span>}</td>
                  <td>{m.model}</td>
                  {/* Una commessa di mezzo impianto (solo corpo, solo
                      container) si vede subito: in ambra, perche' e'
                      l'eccezione da tenere d'occhio. */}
                  <td>
                    {m.scope.na ? (
                      <span className="muted">—</span>
                    ) : m.scope.partial ? (
                      <ScopeTag scope={m.scope} />
                    ) : (
                      <span className="small">{m.scope.label}</span>
                    )}
                  </td>
                  <td>
                    {ct ? (
                      <span className="ctype-badge" style={{ background: `${ct.color}1f`, color: ct.color }}>
                        {ct.short}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {KITS.map((k) => (
                    <td key={k.key} style={{ textAlign: "center" }}>
                      {hasKit(k.key, m.plantType, m.sheetKinds) ? (
                        <input
                          type="checkbox"
                          checked={m[k.key]}
                          readOnly
                          tabIndex={-1}
                          aria-label={`${k.label}: ${m[k.key] ? "sì" : "no"}`}
                          style={{ pointerEvents: "none", accentColor: "var(--accent)", width: 15, height: 15 }}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  ))}
                  <td>{m.customer}</td>
                  <td>
                    <div className="country-cell">
                      <Flag code={m.countryCode} /> <span>{m.country}</span>
                    </div>
                  </td>
                  <td className="mono">{m.year}</td>
                  <td>
                    <span className="badge">
                      <span
                        className="badge-dot"
                        style={{ background: STATUS_META[m.status].color }}
                      />
                      {STATUS_META[m.status].label}
                    </span>
                  </td>
                  <td>
                    <div className="row-progress">
                      <div className="row-progress-bar">
                        <span
                          style={{
                            width: m.progress + "%",
                            background: STATUS_META[m.status].color,
                          }}
                        />
                      </div>
                      <span className="mono small">{m.progress}%</span>
                    </div>
                  </td>
                  <td>
                    <AlertCell alert={m.schede} />
                  </td>
                  <td>
                    <AlertCell alert={m.collaudo} />
                  </td>
                  <td>
                    <AlertCell alert={m.docAlberi} />
                  </td>
                  <td>
                    <Icon name="chev-right" size={16} color="var(--muted)" />
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="empty">
                    Nessuna macchina trovata.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          total={filtered.length}
          perPage={perPage}
          page={curPage}
          totalPages={totalPages}
          onRows={setRows}
          onPage={go}
        />
      </div>

      {peek && <OrdersPeek peek={peek} />}
    </div>
  );
}

/** Righe per pagina: le misure chieste, con 20 come partenza. */
const PER_PAGE = [5, 10, 20, 100];
const PER_PAGE_DEFAULT = 20;
const PER_PAGE_KEY = "zato:macchine:righe";
/** Colonne della tabella: fisse + una per kit (serve alla riga "nessun risultato"). */
const COLS = 14 + KITS.length;

/**
 * Piede della tabella: quante righe per volta e su che pagina si e'. Sta
 * **sotto** l'elenco, dove si arriva scorrendo: a 5 righe per pagina i
 * pulsanti devono essere li' dove finisce la tabella, non in cima.
 */
function Pager({
  total,
  perPage,
  page,
  totalPages,
  onRows,
  onPage,
}: {
  total: number;
  perPage: number;
  page: number;
  totalPages: number;
  onRows: (n: number) => void;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="table-pager">
      <span className="muted small">
        {total === 0 ? "Nessun fascicolo" : `${from}–${to} di ${total} fascicoli`}
      </span>
      <span className="table-pager-rows">
        <span className="muted small">Righe</span>
        {PER_PAGE.map((n) => (
          <button
            key={n}
            className={"chip-btn" + (perPage === n ? " active" : "")}
            onClick={() => onRows(n)}
          >
            {n}
          </button>
        ))}
      </span>
      <span className="table-pager-nav">
        <button className="btn-ghost-sm" disabled={page <= 1} onClick={() => onPage(1)} title="Prima pagina">
          «
        </button>
        <button className="btn-ghost-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} title="Pagina precedente">
          ‹
        </button>
        <span className="muted small mono">
          {page} / {totalPages}
        </span>
        <button
          className="btn-ghost-sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          title="Pagina successiva"
        >
          ›
        </button>
        <button
          className="btn-ghost-sm"
          disabled={page >= totalPages}
          onClick={() => onPage(totalPages)}
          title="Ultima pagina"
        >
          »
        </button>
      </span>
    </div>
  );
}

/**
 * Gli ordini di produzione del fascicolo sotto il puntatore. In officina una
 * macchina la si chiama col numero dell'ordine (H/2026/691), e per leggerlo si
 * doveva aprire il fascicolo e scorrere fino ad Analisi ore.
 *
 * E' **fissa rispetto alla finestra** e ancorata al rettangolo della riga, non
 * al puntatore: inseguire il mouse la farebbe tremolare. Non prende eventi
 * (`pointer-events: none`), altrimenti si frapporrebbe al clic sulla riga.
 */
function OrdersPeek({ peek }: { peek: Peek }) {
  const { m } = peek;
  const h = 62 + m.orders.length * 32;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  // sopra la riga se c'e' posto, altrimenti sotto
  const top = peek.top > h + 16 ? peek.top - h - 8 : Math.min(peek.bottom + 8, vh - h - 8);
  return (
    <div className="orders-peek" style={{ top: Math.max(8, top), left: Math.max(8, Math.min(peek.left + 28, vw - 400)) }}>
      <div className="orders-peek-head">
        <span className="mono">{m.job}</span>
        <span className="muted small">
          {m.code} · {m.customer}
        </span>
      </div>
      <ul>
        {m.orders.map((o) => (
          <li key={o.role + o.ref}>
            <span className="orders-peek-role">Ordine {o.role}</span>
            <span className="orders-peek-ref mono">{o.ref}</span>
            <span className="orders-peek-desc">{o.desc || "—"}</span>
            {o.hours ? <span className="muted small mono">{o.hours.toFixed(1)} h</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Fascicolo con una scheda sola: targhetta **ferma** (non è una cosa da fare,
 * è com'è fatta quella commessa) e un colore per scheda, così corpo e
 * container si distinguono senza leggere.
 */
const SCOPE_TAG: Record<string, { text: string; color: string }> = {
  TRITURATORE: { text: "Solo corpo", color: "#0284c7" },
  CONTAINER: { text: "Solo container", color: "#ea580c" },
};

function ScopeTag({ scope }: { scope: SheetsScope }) {
  const t = scope.kinds.length === 1 ? SCOPE_TAG[scope.kinds[0]] : undefined;
  const text = t?.text ?? `Solo ${scope.label.toLowerCase()}`;
  const color = t?.color ?? "var(--text-2)";
  return (
    <span
      className="scope-tag"
      style={{ color, background: `${color}1a`, borderColor: `${color}40` }}
      title="Il fascicolo comprende una sola scheda di allestimento"
    >
      {text}
    </span>
  );
}

/**
 * Semaforo di una colonna di controllo: **rosso lampeggiante** finché manca
 * qualcosa (deve farsi notare in un elenco di duecento righe), **verde fisso**
 * quando è a posto, "—" dove quella cosa non è prevista per la tipologia.
 * Il titolo dice che cosa manca, così non serve aprire il fascicolo.
 */
function AlertCell({ alert }: { alert: MachineAlert }) {
  if (alert.state === "na") return <span className="muted">—</span>;
  // Tre stati, tre letture diverse: fatto · manca una firma (ambra ferma) ·
  // c'è ancora da compilare (rosso che lampeggia).
  const s = alert.state;
  const cls = s === "ok" ? "ok" : s === "sign" ? "sign" : "warn";
  return (
    <span className={"alert-pill " + cls} title={alert.detail}>
      <Icon name={s === "ok" ? "check" : s === "sign" ? "sign" : "flag"} size={12} />
      {s === "ok" ? "OK" : s === "sign" ? "Da firmare" : "Da fare"}
    </span>
  );
}
