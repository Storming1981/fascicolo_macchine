"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { PLANT_TYPES } from "@/lib/plant";

export type ArticleRow = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  pinned: boolean;
  plantType: string | null;
  excerpt: string;
  updatedAt: string;
};

export default function KnowledgeList({
  articles,
  canManage,
}: {
  articles: ArticleRow[];
  canManage: boolean;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("__all");
  const [showNew, setShowNew] = useState(false);

  const categories = useMemo(() => {
    const set = new Set(articles.map((a) => a.category));
    return [...set].sort();
  }, [articles]);

  const filtered = articles.filter((a) => {
    if (cat !== "__all" && a.category !== cat) return false;
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      a.title.toLowerCase().includes(t) ||
      a.excerpt.toLowerCase().includes(t) ||
      a.tags.some((tag) => tag.toLowerCase().includes(t))
    );
  });

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Knowledge ZATO</h1>
          <p>Procedure, know-how e documentazione del macromondo ZATO</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} /> Nuovo articolo
          </button>
        )}
      </div>

      <RecurringIssuesPanel canManage={canManage} />

      <div className="kb-toolbar">
        <div className="search" style={{ maxWidth: 340 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input placeholder="Cerca per titolo, contenuto, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="kb-cats">
          <button className={"kb-cat" + (cat === "__all" ? " active" : "")} onClick={() => setCat("__all")}>
            Tutte
          </button>
          {categories.map((c) => (
            <button key={c} className={"kb-cat" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">Nessun articolo.</div>
      ) : (
        <div className="kb-grid">
          {filtered.map((a) => (
            <Link key={a.id} href={`/knowledge/${a.id}`} className="kb-card">
              <div className="kb-card-top">
                <span className="kb-cat-chip">{a.category}</span>
                {a.pinned && <Icon name="pin" size={14} color="var(--accent)" />}
              </div>
              <div className="kb-card-title">{a.title}</div>
              <div className="kb-card-excerpt">{a.excerpt}</div>
              <div className="kb-card-tags">
                {a.tags.slice(0, 4).map((t) => (
                  <span key={t} className="ai-tag">#{t}</span>
                ))}
                {a.plantType && <span className="kb-plant">{a.plantType}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && <NewArticleModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

/* ── Problematiche ricorrenti (analisi AI del corpus) ─────── */
type RecurringIssue = {
  theme: string;
  frequency: number;
  affectedModels?: string[];
  plantTypes?: string[];
  probableCauses?: string[];
  recommendations?: string[];
};
type Insight = {
  createdAt: string;
  interventiCount: number;
  generatedByName: string | null;
  data: { summary: string; issues: RecurringIssue[] };
};

function RecurringIssuesPanel({ canManage }: { canManage: boolean }) {
  const [insight, setInsight] = useState<Insight | null | undefined>(undefined);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  function load() {
    fetch("/api/knowledge/analyze")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setInsight(d.insight ?? null);
          setAiConfigured(!!d.aiConfigured);
        } else setInsight(null);
      })
      .catch(() => setInsight(null));
  }
  useEffect(load, []);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/knowledge/analyze", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (r.ok) setInsight(d.insight);
      else setErr(d?.error ?? "Errore analisi");
    } finally {
      setBusy(false);
    }
  }

  if (insight === undefined) return null;

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <h3>
          <button className="kb-collapse" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "chev-down" : "chev-right"} size={14} /> Problematiche ricorrenti (AI)
          </button>
        </h3>
        {canManage && (
          <button className="btn-ghost-sm" onClick={generate} disabled={busy || !aiConfigured}>
            <Icon name="clock" size={13} /> {busy ? "Analisi…" : insight ? "Rigenera" : "Genera analisi"}
          </button>
        )}
      </div>

      {!aiConfigured && (
        <p className="muted small">AI non configurata (ANTHROPIC_API_KEY): analisi non disponibile.</p>
      )}
      {err && <p className="form-error">{err}</p>}

      {open && (
        insight ? (
          <>
            <p className="muted small" style={{ marginBottom: 10 }}>
              {insight.data.summary} <span className="mono">· {insight.interventiCount} interventi ·{" "}
              {new Date(insight.createdAt).toLocaleDateString("it-IT")}</span>
            </p>
            <div className="ri-grid">
              {insight.data.issues.map((it, i) => (
                <div key={i} className="ri-card">
                  <div className="ri-head">
                    <span className="ri-theme">{it.theme}</span>
                    <span className="ri-freq mono">×{it.frequency}</span>
                  </div>
                  {(it.plantTypes?.length || it.affectedModels?.length) ? (
                    <div className="ri-tags">
                      {(it.plantTypes ?? []).map((p) => <span key={p} className="kb-plant">{p}</span>)}
                      {(it.affectedModels ?? []).map((m) => <span key={m} className="ai-tag">{m}</span>)}
                    </div>
                  ) : null}
                  {it.probableCauses?.length ? (
                    <div className="ri-sec"><b>Cause probabili:</b> {it.probableCauses.join("; ")}</div>
                  ) : null}
                  {it.recommendations?.length ? (
                    <div className="ri-sec"><b>Raccomandazioni:</b> {it.recommendations.join("; ")}</div>
                  ) : null}
                </div>
              ))}
              {insight.data.issues.length === 0 && (
                <div className="muted small">Nessuna problematica ricorrente individuata.</div>
              )}
            </div>
          </>
        ) : (
          <p className="muted small">
            Nessuna analisi ancora generata. {canManage ? "Premi “Genera analisi”." : ""}
          </p>
        )
      )}
    </section>
  );
}

function NewArticleModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ title: "", category: "Generale", tags: "", plantType: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.title.trim()) {
      setErr("Inserisci un titolo.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(d?.error ?? "Errore.");
        return;
      }
      onClose();
      router.push(`/knowledge/${d.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nuovo articolo</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Titolo *</span>
            <input value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus />
          </label>
          <div className="sig-row">
            <label className="field">
              <span className="field-label">Categoria</span>
              <input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Es. Manutenzione" />
            </label>
            <label className="field">
              <span className="field-label">Tipologia impianto</span>
              <select value={f.plantType} onChange={(e) => set("plantType", e.target.value)}>
                <option value="">— Nessuna —</option>
                {PLANT_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Tag (separati da virgola)</span>
            <input value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="martelli, usura, P1" />
          </label>
          <label className="field">
            <span className="field-label">Contenuto</span>
            <textarea rows={8} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder="Procedura, note tecniche, riferimenti…" />
          </label>
          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "…" : "Crea articolo"}
          </button>
        </div>
      </div>
    </div>
  );
}
