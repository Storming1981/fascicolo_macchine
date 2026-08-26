"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CustomerHit = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  country: string;
  countryCode: string;
  sites: { id: string; name: string }[];
};

/**
 * Tendina cliente ricercabile sull'anagrafica clienti (`/api/customers/search`).
 * Usata nel wizard "Nuova macchina" e nella modifica anagrafica del fascicolo:
 * il cliente NON va scritto a mano, altrimenti il fascicolo resta scollegato
 * dall'anagrafica (Machine.customerId) e non compare tra le macchine del
 * cliente negli interventi di service.
 */
export default function CustomerPicker({
  currentName,
  onPick,
  placeholder = "Cerca cliente in anagrafica…",
  allowNone = false,
}: {
  currentName: string | null;
  onPick: (c: CustomerHit | null) => void;
  placeholder?: string;
  allowNone?: boolean;
}) {
  const [label, setLabel] = useState(currentName ?? "");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLabel(currentName ?? ""), [currentName]);

  function reposition() {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: r.width });
  }
  useEffect(() => {
    if (!open) return;
    reposition();
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  function runSearch(term: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(term)}`);
        const d = await res.json().catch(() => null);
        if (res.ok && d && Array.isArray(d.customers)) {
          setHits(d.customers);
          setOpen(true);
          reposition();
        }
      } catch {
        /* rete */
      }
    }, 200);
  }

  const dropdown =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            className="art-sugg art-sugg-fixed"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {allowNone && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setLabel("");
                  onPick(null);
                  setOpen(false);
                }}
              >
                <span className="muted">— Nessuno —</span>
              </button>
            )}
            {hits.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setLabel(c.name);
                  onPick(c);
                  setOpen(false);
                }}
              >
                <span>{c.name}</span>
                <span className="muted small">
                  {[c.code, c.city, c.country].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
            {hits.length === 0 && (
              <div className="muted small" style={{ padding: "8px 11px" }}>
                Nessun cliente trovato in anagrafica
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="art-input" ref={boxRef}>
      <input
        className="input"
        value={open ? q : label}
        placeholder={placeholder}
        onFocus={() => {
          setQ("");
          setOpen(true);
          runSearch("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          runSearch(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {dropdown}
    </div>
  );
}
