"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { PLANT_TYPES } from "@/lib/plant";
import { fmtDate } from "@/lib/format";

type Article = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  plantType: string | null;
  body: string;
  pinned: boolean;
  authorName: string | null;
  updatedAt: string;
};

export default function ArticleView({
  article,
  canManage,
}: {
  article: Article;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    title: article.title,
    category: article.category,
    tags: article.tags.join(", "),
    plantType: article.plantType ?? "",
    body: article.body,
    pinned: article.pinned,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/knowledge/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  async function del() {
    if (!confirm("Eliminare questo articolo?")) return;
    await fetch(`/api/knowledge/${article.id}`, { method: "DELETE" });
    router.push("/knowledge");
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <Link href="/knowledge" className="back-link">
            <Icon name="arrow-left" size={14} /> Knowledge
          </Link>
          {!editing ? (
            <>
              <h1>{article.title}</h1>
              <div className="chip-row">
                <span className="kb-cat-chip">{article.category}</span>
                {article.plantType && <span className="kb-plant">{article.plantType}</span>}
                <span className="muted small">
                  Agg. {fmtDate(new Date(article.updatedAt))}
                  {article.authorName ? ` · ${article.authorName}` : ""}
                </span>
              </div>
            </>
          ) : (
            <h1>Modifica articolo</h1>
          )}
        </div>
        {canManage && !editing && (
          <div className="flex-inline" style={{ gap: 8 }}>
            <button className="btn-ghost" onClick={del}>
              <Icon name="trash" size={15} /> Elimina
            </button>
            <button className="btn-primary" onClick={() => setEditing(true)}>
              <Icon name="sign" size={15} /> Modifica
            </button>
          </div>
        )}
      </div>

      {!editing ? (
        <div className="grid-two">
          <section className="card kb-article">
            <div className="kb-body">{renderBody(article.body)}</div>
          </section>
          <section className="card" style={{ alignSelf: "start" }}>
            <div className="card-header"><h3 style={{ fontSize: 13 }}>Dettagli</h3></div>
            <div className="ctx-list">
              <div className="ctx-row">
                <span className="field-label">Categoria</span>
                <span>{article.category}</span>
              </div>
              {article.plantType && (
                <div className="ctx-row">
                  <span className="field-label">Tipologia impianto</span>
                  <span>{article.plantType}</span>
                </div>
              )}
              <div className="ctx-row">
                <span className="field-label">Tag</span>
                <div className="kb-card-tags">
                  {article.tags.length ? article.tags.map((t) => <span key={t} className="ai-tag">#{t}</span>) : <span className="muted small">—</span>}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="card">
          <label className="field">
            <span className="field-label">Titolo</span>
            <input value={f.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <div className="sig-row">
            <label className="field">
              <span className="field-label">Categoria</span>
              <input value={f.category} onChange={(e) => set("category", e.target.value)} />
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
            <input value={f.tags} onChange={(e) => set("tags", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Contenuto</span>
            <textarea rows={14} value={f.body} onChange={(e) => set("body", e.target.value)} />
          </label>
          <label className="flex-inline" style={{ gap: 8, marginTop: 4 }}>
            <input type="checkbox" checked={f.pinned} onChange={(e) => set("pinned", e.target.checked)} />
            <span>In evidenza</span>
          </label>
          <div className="rapportino-actions">
            <button className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
              Annulla
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Salvataggio…" : "Salva"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// Render minimale: titoli "# ", elenco "- ", paragrafi.
function renderBody(body: string) {
  const lines = body.split(/\r?\n/);
  return lines.map((ln, i) => {
    if (/^#{1,3}\s/.test(ln)) {
      const level = ln.match(/^#+/)![0].length;
      const text = ln.replace(/^#+\s/, "");
      if (level === 1) return <h2 key={i}>{text}</h2>;
      if (level === 2) return <h3 key={i}>{text}</h3>;
      return <h4 key={i}>{text}</h4>;
    }
    if (/^[-*]\s/.test(ln)) return <li key={i}>{ln.replace(/^[-*]\s/, "")}</li>;
    if (!ln.trim()) return <br key={i} />;
    return <p key={i}>{ln}</p>;
  });
}
