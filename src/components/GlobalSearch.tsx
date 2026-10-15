"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";

type Hit = { id: string; href: string; title: string; subtitle?: string; meta?: string };
type Group = { key: string; label: string; hits: Hit[]; more?: { href: string; label: string } };

const GROUP_ICON: Record<string, string> = {
  interventi: "wrench",
  rapportini: "doc",
  macchine: "machines",
  clienti: "people",
};

/**
 * Ricerca globale della testata. Mentre si scrive propone i risultati
 * raggruppati (Interventi, Rapportini, Macchine, Clienti) e si naviga da
 * tastiera: ↑/↓ per scegliere, Invio per aprire, Esc per chiudere, "/" o
 * Ctrl+K per arrivarci da qualunque pagina.
 *
 * Invio senza scegliere apre il primo risultato; se i suggerimenti non sono
 * ancora arrivati vale la vecchia regola di `/api/search` (match esatto su
 * matricola, job, INT-…, altrimenti elenco macchine filtrato).
 */
export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  // Elenco piatto delle voci navigabili (risultati + "vedi tutti").
  const flat = useMemo(() => {
    const out: { href: string }[] = [];
    for (const g of groups) {
      for (const h of g.hits) out.push({ href: h.href });
      if (g.more) out.push({ href: g.more.href });
    }
    return out;
  }, [groups]);

  // Suggerimenti con debounce; le risposte vecchie arrivate tardi si scartano.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?suggest=1&q=${encodeURIComponent(term)}`);
        const d = await res.json().catch(() => null);
        if (id !== reqId.current) return;
        setGroups(res.ok && Array.isArray(d?.groups) ? d.groups : []);
        setActive(0);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  // "/" e Ctrl/Cmd+K portano alla ricerca (non mentre si scrive altrove).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clic fuori chiude la tendina.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    inputRef.current?.blur();
    router.push(href);
  }

  async function fallback(term: string) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
      const d = await res.json().catch(() => null);
      if (res.ok && d?.type === "machine" && d.code) return go(`/macchine/${encodeURIComponent(d.code)}`);
      if (res.ok && d?.type === "intervento" && d.id) return go(`/service/interventi/${d.id}`);
      if (res.ok && d?.type === "customer" && d.id) return go(`/service/clienti/${d.id}`);
    } catch {
      /* si ripiega sull'elenco */
    }
    go(`/macchine?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else setQ("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      const term = q.trim();
      if (!term) return go("/macchine");
      if (!loading && flat[active]) return go(flat[active].href);
      fallback(term);
    }
  }

  const term = q.trim();
  const showPanel = open && term.length >= 2;
  let idx = -1;

  return (
    <div className="gsearch" ref={boxRef}>
      <div className="search">
        <Icon name="search" size={15} color="var(--muted)" />
        <input
          ref={inputRef}
          placeholder="Cerca interventi, rapportini, macchine, clienti…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Cerca"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="gsearch-panel"
          autoComplete="off"
        />
        {q ? (
          <button className="gsearch-clear" onClick={() => setQ("")} aria-label="Cancella ricerca" type="button">
            <Icon name="x" size={13} />
          </button>
        ) : (
          <kbd className="gsearch-kbd" title="Premi / oppure Ctrl+K">/</kbd>
        )}
      </div>

      {showPanel && (
        <div className="gsearch-panel" id="gsearch-panel" role="listbox">
          {loading && groups.length === 0 && <div className="gsearch-empty">Ricerca…</div>}
          {!loading && groups.length === 0 && (
            <div className="gsearch-empty">
              Nessun risultato per <b>{term}</b>.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key} className="gsearch-group">
              <div className="gsearch-group-head">
                <Icon name={GROUP_ICON[g.key] ?? "search"} size={12} /> {g.label}
              </div>
              {g.hits.map((h) => {
                idx++;
                const i = idx;
                return (
                  <button
                    key={g.key + h.id}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={"gsearch-hit" + (i === active ? " active" : "")}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(h.href)}
                  >
                    <div className="gsearch-hit-main">
                      <div className="gsearch-hit-title">{h.title}</div>
                      {h.subtitle && <div className="gsearch-hit-sub">{h.subtitle}</div>}
                    </div>
                    {h.meta && <span className="gsearch-hit-meta">{h.meta}</span>}
                  </button>
                );
              })}
              {g.more &&
                (() => {
                  idx++;
                  const i = idx;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      className={"gsearch-more" + (i === active ? " active" : "")}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(g.more!.href)}
                    >
                      {g.more!.label} →
                    </button>
                  );
                })()}
            </div>
          ))}
          <div className="gsearch-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> scegli</span>
            <span><kbd>Invio</kbd> apri</span>
            <span><kbd>Esc</kbd> chiudi</span>
          </div>
        </div>
      )}
    </div>
  );
}
