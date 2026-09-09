"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";

/**
 * Il dizionario tecnico ZATO.
 *
 * Non è documentazione: è la mappa fra come parla il cantiere e come scrive il
 * manuale. Ogni alias aggiunto qui migliora subito il retrieval per tutti.
 */

type Term = {
  id: string;
  term: string;
  aliases: string[];
  definition: string | null;
  category: string;
  plantType: string | null;
};

const CATEGORIES = [
  "Meccanica",
  "Idraulica",
  "Elettrico",
  "Processo",
  "Sicurezza",
  "Manutenzione",
  "Cantiere",
  "Generale",
];

export default function GlossaryPanel({ canManage }: { canManage: boolean }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("__all");
  const [editing, setEditing] = useState<Term | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/knowledge/glossary");
      const d = await r.json().catch(() => null);
      if (r.ok) setTerms(d.terms ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => [...new Set(terms.map((t) => t.category))].sort(), [terms]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return terms.filter((t) => {
      if (cat !== "__all" && t.category !== cat) return false;
      if (!s) return true;
      return (
        t.term.toLowerCase().includes(s) ||
        t.aliases.some((a) => a.toLowerCase().includes(s)) ||
        (t.definition ?? "").toLowerCase().includes(s)
      );
    });
  }, [terms, q, cat]);

  async function seed() {
    setBusy(true);
    try {
      await fetch("/api/knowledge/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Term) {
    if (!confirm(`Rimuovere "${t.term}" dal dizionario?`)) return;
    await fetch(`/api/knowledge/glossary/${t.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <div className="kb-intro">
        <Icon name="doc" size={16} color="var(--accent)" />
        <p>
          Il dizionario insegna al Brain il gergo di cantiere. Se un tecnico scrive <em>“il rotore si
          pianta”</em> e il manuale dice <em>“bloccaggio del rotore”</em>, la ricerca trova comunque la
          procedura giusta. Ogni voce vale per tutte le domande, presenti e future.
        </p>
      </div>

      <div className="kb-toolbar">
        <div className="search" style={{ maxWidth: 320 }}>
          <Icon name="search" size={15} color="var(--muted)" />
          <input placeholder="Cerca termine o sinonimo…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="kb-cats">
          <button className={"kb-cat" + (cat === "__all" ? " active" : "")} onClick={() => setCat("__all")}>
            Tutte ({terms.length})
          </button>
          {categories.map((c) => (
            <button key={c} className={"kb-cat" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {canManage && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {terms.length === 0 && (
              <button className="btn-ghost" onClick={() => void seed()} disabled={busy}>
                <Icon name="download" size={15} /> Carica dizionario base
              </button>
            )}
            <button className="btn-primary" onClick={() => setEditing("new")}>
              <Icon name="plus" size={15} /> Nuovo termine
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card empty-state">Carico il dizionario…</div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          {terms.length === 0 ? (
            <>
              Dizionario vuoto.
              {canManage && " Carica il dizionario base: ~45 voci del gergo ZATO, poi ampliale nel tempo."}
            </>
          ) : (
            "Nessun termine corrisponde alla ricerca."
          )}
        </div>
      ) : (
        <div className="kb-terms">
          {filtered.map((t) => (
            <div key={t.id} className="kb-term">
              <div className="kb-term-head">
                <strong>{t.term}</strong>
                <span className="kb-cat-chip">{t.category}</span>
                {canManage && (
                  <span className="kb-term-actions">
                    <button className="icon-btn" title="Modifica" onClick={() => setEditing(t)}>
                      <Icon name="wrench" size={14} />
                    </button>
                    <button className="icon-btn" title="Elimina" onClick={() => void remove(t)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                )}
              </div>
              {t.definition && <p className="kb-term-def">{t.definition}</p>}
              {t.aliases.length > 0 && (
                <div className="kb-term-aliases">
                  {t.aliases.map((a) => (
                    <span key={a} className="ai-tag">
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TermModal
          term={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TermModal({
  term,
  onClose,
  onDone,
}: {
  term: Term | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(term?.term ?? "");
  const [aliases, setAliases] = useState(term?.aliases.join(", ") ?? "");
  const [definition, setDefinition] = useState(term?.definition ?? "");
  const [category, setCategory] = useState(term?.category ?? "Generale");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError("Il termine è obbligatorio");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({ term: name.trim(), aliases, definition, category });
      const r = term
        ? await fetch(`/api/knowledge/glossary/${term.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
          })
        : await fetch("/api/knowledge/glossary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(d?.error ?? `Errore ${r.status}`);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{term ? "Modifica termine" : "Nuovo termine"}</h3>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="kb-field">
            <span>Termine canonico (come lo chiama il manuale)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Controlama" />
          </label>
          <label className="kb-field">
            <span>Sinonimi e gergo (separati da virgola)</span>
            <input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="contro lama, controcoltello, matrice di taglio"
            />
          </label>
          <label className="kb-field">
            <span>Categoria</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="kb-field">
            <span>Definizione breve (facoltativa, va nel prompt del Brain)</span>
            <textarea
              rows={3}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="Elemento fisso contrapposto alla lama; il gioco lama-controlama è critico."
            />
          </label>
          {error && <div className="kb-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? "Salvo…" : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
}
