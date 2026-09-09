"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { PLANT_TYPES } from "@/lib/plant";

/** Gestione delle fonti indicizzate: caricamento, stato, reindicizzazione. */

export type SourceRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  error: string | null;
  visibility: string;
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  videoUrl: string | null;
  plantType: string | null;
  model: string | null;
  tags: string[];
  chunkCount: number;
  tokensEstimate: number;
  ocrUsed: boolean;
  indexedAt: string | null;
  uploadedByName: string | null;
  originKind: string | null;
  updatedAt: string;
};

const UPLOADABLE = [
  { key: "MANUAL", label: "Manuale macchina" },
  { key: "PROCEDURE", label: "Procedura standard" },
  { key: "CASE", label: "Caso risolto" },
  { key: "DRAWING", label: "Disegno tecnico" },
  { key: "VIDEO", label: "Video procedura" },
  { key: "BULLETIN", label: "Bollettino tecnico" },
  { key: "SPARE", label: "Catalogo ricambi" },
  { key: "OTHER", label: "Altro documento" },
];

const TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(UPLOADABLE.map((u) => [u.key, u.label])),
  ARTICLE: "Articolo interno",
  RAPPORTINO: "Rapportino",
  CHAT: "Chat cantiere",
  DIARY: "Diario macchina",
};

const STATUS_LABEL: Record<string, string> = {
  READY: "Indicizzato",
  PENDING: "In coda",
  PROCESSING: "In lavorazione",
  FAILED: "Errore",
};

function fmtSize(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function SourcesPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("__all");
  const [showUpload, setShowUpload] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/knowledge/sources");
      const d = await r.json().catch(() => null);
      if (r.ok) setRows(d.sources ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "__uploaded" && r.originKind) return false;
      if (filter === "__derived" && !r.originKind) return false;
      if (filter === "__problem" && r.status !== "FAILED") return false;
      if (!["__all", "__uploaded", "__derived", "__problem"].includes(filter) && r.type !== filter) return false;
      if (!t) return true;
      return (
        r.title.toLowerCase().includes(t) ||
        (r.plantType ?? "").toLowerCase().includes(t) ||
        r.tags.some((tag) => tag.toLowerCase().includes(t))
      );
    });
  }, [rows, q, filter]);

  const totals = useMemo(() => {
    const chunks = rows.reduce((s, r) => s + r.chunkCount, 0);
    const failed = rows.filter((r) => r.status === "FAILED").length;
    const uploaded = rows.filter((r) => !r.originKind).length;
    return { chunks, failed, uploaded, total: rows.length };
  }, [rows]);

  async function reindex(id: string) {
    setNotice("Reindicizzazione in corso…");
    const r = await fetch(`/api/knowledge/sources/${id}/reindex`, { method: "POST" });
    const d = await r.json().catch(() => null);
    setNotice(r.ok ? `Reindicizzato: ${d?.result?.chunks ?? 0} frammenti` : d?.error ?? "Errore");
    await load();
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Eliminare "${title}" dalla knowledge base?`)) return;
    const r = await fetch(`/api/knowledge/sources/${id}`, { method: "DELETE" });
    if (r.ok) await load();
  }

  async function syncCorpus() {
    setSyncing(true);
    setNotice("Rileggo rapportini, chat e diari…");
    try {
      const r = await fetch("/api/knowledge/corpus-sync", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (r.ok) {
        const s = d.result;
        setNotice(
          `Corpus aggiornato — rapportini ${s.rapportini.indexed}, chat ${s.chat.indexed}, ` +
            `diari ${s.diari.indexed}, articoli ${s.articoli.indexed}`
        );
        await load();
      } else setNotice(d?.error ?? "Errore di sincronizzazione");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="kb-stats">
        <Stat label="Fonti indicizzate" value={String(totals.total)} hint={`${totals.uploaded} caricate a mano`} />
        <Stat label="Frammenti cercabili" value={totals.chunks.toLocaleString("it-IT")} hint="unità di ricerca" />
        <Stat
          label="Da sistemare"
          value={String(totals.failed)}
          hint={totals.failed ? "documenti non leggibili" : "tutto a posto"}
          alert={totals.failed > 0}
        />
      </div>

      {notice && (
        <div className="kb-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="kb-toolbar">
        <div className="search" style={{ maxWidth: 320 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input placeholder="Cerca fonte…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="kb-cats">
          {[
            { k: "__all", l: "Tutte" },
            { k: "__uploaded", l: "Caricate" },
            { k: "__derived", l: "Dal campo" },
            { k: "MANUAL", l: "Manuali" },
            { k: "PROCEDURE", l: "Procedure" },
            { k: "VIDEO", l: "Video" },
            { k: "DRAWING", l: "Disegni" },
            { k: "__problem", l: "Con errori" },
          ].map((c) => (
            <button
              key={c.k}
              className={"kb-cat" + (filter === c.k ? " active" : "")}
              onClick={() => setFilter(c.k)}
            >
              {c.l}
            </button>
          ))}
        </div>
        {canManage && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={() => void syncCorpus()} disabled={syncing}>
              <Icon name="download" size={15} /> {syncing ? "Sincronizzo…" : "Aggiorna dal campo"}
            </button>
            <button className="btn-primary" onClick={() => setShowUpload(true)}>
              <Icon name="upload" size={15} /> Carica documento
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card empty-state">Carico le fonti…</div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          Nessuna fonte.{" "}
          {canManage && "Carica i manuali delle macchine per dare al Brain qualcosa su cui rispondere."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Impianto</th>
                <th>Indice</th>
                <th>Stato</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="kb-src-title">
                      {r.filePath ? (
                        <a href={r.filePath} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      {r.visibility === "CUSTOMER" && <span className="kb-vis">portale cliente</span>}
                    </div>
                    <div className="kb-src-meta">
                      {r.fileName && `${r.fileName} · `}
                      {r.pageCount ? `${r.pageCount} pag. · ` : ""}
                      {fmtSize(r.sizeBytes)}
                      {r.ocrUsed && " · letto con AI"}
                    </div>
                  </td>
                  <td>{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td>
                    {r.plantType ?? "—"}
                    {r.model ? <div className="kb-src-meta">{r.model}</div> : null}
                  </td>
                  <td>
                    {r.chunkCount > 0 ? (
                      <>
                        <strong>{r.chunkCount}</strong> frammenti
                        <div className="kb-src-meta">~{r.tokensEstimate.toLocaleString("it-IT")} token</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className={"kb-status kb-" + r.status.toLowerCase()}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    {r.error && <div className="kb-src-error">{r.error}</div>}
                  </td>
                  {canManage && (
                    <td className="kb-src-actions">
                      <button className="icon-btn" title="Reindicizza" onClick={() => void reindex(r.id)}>
                        <Icon name="download" size={15} />
                      </button>
                      <button className="icon-btn" title="Elimina" onClick={() => void remove(r.id, r.title)}>
                        <Icon name="trash" size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={() => {
            setShowUpload(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className={"kb-stat" + (alert ? " kb-stat-alert" : "")}>
      <div className="kb-stat-value">{value}</div>
      <div className="kb-stat-label">{label}</div>
      {hint && <div className="kb-stat-hint">{hint}</div>}
    </div>
  );
}

/* ───────────────────────── Caricamento ───────────────────────── */

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState("MANUAL");
  const [title, setTitle] = useState("");
  const [plantType, setPlantType] = useState("");
  const [model, setModel] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("INTERNAL");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isVideo = type === "VIDEO";

  async function submit() {
    setError(null);
    if (!file && !videoUrl.trim() && !description.trim()) {
      setError("Allega un file, indica un link video oppure incolla il testo della procedura.");
      return;
    }
    if (!file && !title.trim()) {
      setError("Il titolo è obbligatorio.");
      return;
    }
    setBusy(true);
    setProgress(
      file && file.type === "application/pdf"
        ? "Estraggo il testo dal PDF… i manuali scansionati richiedono qualche minuto."
        : "Indicizzo il documento…"
    );
    try {
      const fd = new FormData();
      fd.set("type", type);
      if (title.trim()) fd.set("title", title.trim());
      if (plantType) fd.set("plantType", plantType);
      if (model.trim()) fd.set("model", model.trim());
      if (tags.trim()) fd.set("tags", tags.trim());
      fd.set("visibility", visibility);
      if (description.trim()) fd.set("description", description.trim());
      if (videoUrl.trim()) fd.set("videoUrl", videoUrl.trim());
      if (file) fd.set("file", file);

      const r = await fetch("/api/knowledge/sources", { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setError(d?.error ?? `Errore ${r.status}`);
        return;
      }
      if (!d.ok) {
        setError(d?.result?.error ?? "Documento caricato ma non indicizzabile: nessun testo estratto.");
        return;
      }
      onDone();
    } catch {
      setError("Errore di rete durante il caricamento");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Carica nella Knowledge</h3>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <label>
              <span>Tipo di contenuto</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {UPLOADABLE.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Visibilità</span>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="INTERNAL">Solo interno ZATO</option>
                <option value="CUSTOMER">Anche portale cliente</option>
              </select>
            </label>
            <label>
              <span>Tipologia impianto</span>
              <select value={plantType} onChange={(e) => setPlantType(e.target.value)}>
                <option value="">Tutte / non specificata</option>
                {PLANT_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Modello (facoltativo)</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="es. MULINO 16-13" />
            </label>
          </div>

          <div className="kb-drop" onClick={() => inputRef.current?.click()}>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept={isVideo ? "video/*" : ".pdf,.docx,.txt,.md,.csv,image/*"}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
            <Icon name="upload" size={22} color="var(--accent)" />
            {file ? (
              <div>
                <strong>{file.name}</strong>
                <div className="kb-src-meta">{fmtSize(file.size)}</div>
              </div>
            ) : (
              <div>
                <strong>{isVideo ? "Carica il video (facoltativo)" : "Scegli un file"}</strong>
                <div className="kb-src-meta">
                  {isVideo
                    ? "Massimo 60 MB. Per i filmati più pesanti usa il link qui sotto."
                    : "PDF, Word (.docx), testo o immagini. I disegni e le foto vengono descritti dall'AI e resi cercabili."}
                </div>
              </div>
            )}
          </div>

          {isVideo && (
            <label className="kb-field">
              <span>…oppure il link del video (YouTube, Vimeo o URL interno)</span>
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
          )}

          <label className="kb-field">
            <span>Titolo</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="es. Manuale d'uso BLUE DEVIL — cambio martelli"
            />
          </label>

          <label className="kb-field">
            <span>
              {isVideo
                ? "Capitoli / trascrizione (una riga per passaggio: «02:15 Smontare il carter»)"
                : "Note e contesto (facoltativo, entra nell'indice)"}
            </span>
            <textarea
              rows={isVideo ? 6 : 3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isVideo
                  ? "00:00 Introduzione e DPI\n02:15 Sezionamento e messa in sicurezza\n05:40 Smontaggio del carter"
                  : "A cosa serve questo documento, quando si usa, avvertenze."
              }
            />
          </label>

          <label className="kb-field">
            <span>Tag (separati da virgola)</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="martelli, usura, rotore" />
          </label>

          {progress && <div className="kb-notice">{progress}</div>}
          {error && <div className="kb-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Indicizzo…" : "Carica e indicizza"}
          </button>
        </div>
      </div>
    </div>
  );
}
