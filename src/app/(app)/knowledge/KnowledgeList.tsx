"use client";
import { useMemo, useState } from "react";
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
