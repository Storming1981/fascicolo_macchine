"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  SHEET_KINDS,
  YES_NO,
  YES_NO_NA,
  isListRow,
  listKey,
  listOptions,
  sheetCommessa,
  sheetCtx,
  sheetDef,
  visibleRows,
  type SheetHeader,
  type SheetKind,
  type SheetOptions,
  type SheetRow,
  type SheetValues,
} from "@/lib/allestimento";
import { fmtDateTime } from "@/lib/format";

type Item = { id: string; position: number; label: string; serial: string | null; note: string | null };
type Comp = { id: string; groupId: string; items: Item[] };

type SheetDTO = {
  kind: SheetKind;
  header: SheetHeader;
  values: SheetValues;
  status: "DRAFT" | "SIGNED";
  compilerName: string | null;
  compiledAt: string | null;
  compilerSignature: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

const KIND_META: Record<SheetKind, { label: string; icon: string }> = {
  TRITURATORE: { label: "Trituratore", icon: "gear" },
  CONTAINER: { label: "Container", icon: "box" },
};

const filled = (v: string | undefined) => !!(v ?? "").trim();

/**
 * Schede di allestimento BLUE DEVIL dentro Componenti & Matricole. Le matricole
 * e le foto usano le stesse celle dell'elenco componenti (render props), così
 * OCR, diario e foto per slot restano un solo flusso.
 */
export default function AllestimentoSheets({
  machine,
  canEdit,
  canSign,
  canManageOptions,
  hasSavedSignature,
  renderSerial,
  renderPhoto,
  onDone,
  notify,
}: {
  machine: {
    id: string;
    model: string;
    job: string;
    jobBody: string | null;
    jobContainer: string | null;
    country: string;
    components: Comp[];
  };
  canEdit: boolean;
  canSign: boolean;
  canManageOptions: boolean;
  hasSavedSignature: boolean;
  renderSerial: (item: Item) => ReactNode;
  renderPhoto: (itemId: string, title: string) => ReactNode;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [kind, setKind] = useState<SheetKind>("TRITURATORE");
  const [sheets, setSheets] = useState<Record<string, SheetDTO> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { header: SheetHeader; values: SheetValues }>>({});
  const [options, setOptions] = useState<SheetOptions>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/machines/${machine.id}/allestimento`, { cache: "no-store" });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) {
      setLoadErr(d?.error ?? "Impossibile caricare le schede");
      return;
    }
    setSheets(d.sheets);
    setOptions(d.options ?? {});
    setDrafts(
      Object.fromEntries(
        Object.entries(d.sheets as Record<string, SheetDTO>).map(([k, s]) => [k, { header: s.header, values: s.values }])
      )
    );
    setDirty({});
    // gruppi componente appena creati (es. Blocchi motore): serve il fascicolo aggiornato
    if (d.created > 0) onDone();
  }, [machine.id, onDone]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.id]);

  const sheet = sheets?.[kind];
  const draft = drafts[kind];
  const def = sheetDef(kind);
  const ctx = useMemo(() => sheetCtx(kind, draft?.header ?? {}, machine.model), [kind, draft?.header, machine.model]);

  function setHeader(k: keyof SheetHeader, v: string) {
    setDrafts((s) => ({ ...s, [kind]: { ...s[kind], header: { ...s[kind].header, [k]: v } } }));
    setDirty((s) => ({ ...s, [kind]: true }));
  }
  function setValue(key: string, field: "spec" | "serial" | "note", v: string) {
    setDrafts((s) => ({
      ...s,
      [kind]: { ...s[kind], values: { ...s[kind].values, [key]: { ...s[kind].values[key], [field]: v } } },
    }));
    setDirty((s) => ({ ...s, [kind]: true }));
  }

  async function save(silent = false): Promise<boolean> {
    if (!draft) return false;
    if (
      !silent &&
      sheet?.status === "SIGNED" &&
      !confirm("La scheda è firmata: salvando le modifiche la firma decade e andrà rifirmata. Continuare?")
    )
      return false;
    setBusy(true);
    const res = await fetch(`/api/machines/${machine.id}/allestimento`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, header: draft.header, values: draft.values }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify(d.error || "Errore nel salvataggio", "err");
      return false;
    }
    if (!silent) notify(d.signatureRevoked ? "Scheda salvata — la firma è decaduta" : "Scheda salvata");
    await load();
    onDone();
    return true;
  }

  async function addOption(list: string, value: string): Promise<boolean> {
    const res = await fetch("/api/allestimento/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list, value }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify(d.error || "Voce non aggiunta", "err");
      return false;
    }
    setOptions(d.options ?? {});
    notify(`«${value}» aggiunto all'elenco`);
    return true;
  }

  async function removeOption(list: string, value: string) {
    if (!confirm(`Togliere «${value}» dall'elenco? I fascicoli già compilati non cambiano.`)) return;
    const res = await fetch(
      `/api/allestimento/options?list=${encodeURIComponent(list)}&value=${encodeURIComponent(value)}`,
      { method: "DELETE" }
    );
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return notify(d.error || "Voce non rimossa", "err");
    setOptions(d.options ?? {});
  }

  if (loadErr) return <div className="form-error">{loadErr}</div>;
  if (!sheets || !draft)
    return <div className="al-loading muted">Caricamento schede di allestimento…</div>;

  const compOf = (groupId: string) => machine.components.find((c) => c.groupId === groupId);
  const disabled = !canEdit || busy;

  const sections = def.sections
    .map((s) => {
      const rows = visibleRows(s, ctx);
      return { s, rows, done: rows.filter((r) => filled(draft.values[r.key]?.spec)).length };
    })
    .filter((x) => x.rows.length);
  const total = sections.reduce((a, x) => a + x.rows.length, 0);
  const done = sections.reduce((a, x) => a + x.done, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  function kindProgress(k: SheetKind) {
    const d = drafts[k];
    if (!d) return 0;
    const c = sheetCtx(k, d.header, machine.model);
    const rows = sheetDef(k).sections.flatMap((s) => visibleRows(s, c));
    return rows.length ? Math.round((rows.filter((r) => filled(d.values[r.key]?.spec)).length / rows.length) * 100) : 0;
  }

  function specControl(row: SheetRow) {
    const val = draft.values[row.key]?.spec ?? "";
    if (row.input === "yesno" || row.input === "yesnona") {
      const opts = row.input === "yesno" ? YES_NO : YES_NO_NA;
      return (
        <div className="al-choice" role="radiogroup" aria-label={row.label}>
          {opts.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={val === o}
              disabled={disabled}
              className={"al-choice-btn " + (o === "Sì" ? "yes" : o === "No" ? "no" : "na") + (val === o ? " active" : "")}
              onClick={() => setValue(row.key, "spec", val === o ? "" : o)}
            >
              {o === "Sì" && <Icon name="check" size={13} />}
              {o}
            </button>
          ))}
        </div>
      );
    }
    if (isListRow(row)) {
      const list = listKey(kind, row);
      return (
        <Combobox
          value={val}
          options={listOptions(kind, row, options)}
          custom={options[list] ?? []}
          disabled={disabled}
          canRemove={canManageOptions}
          onChange={(v) => setValue(row.key, "spec", v)}
          onAdd={async (v) => {
            if (await addOption(list, v)) setValue(row.key, "spec", v);
          }}
          onRemove={(v) => removeOption(list, v)}
        />
      );
    }
    return (
      <input
        className="al-input"
        value={val}
        disabled={disabled}
        onChange={(e) => setValue(row.key, "spec", e.target.value)}
        placeholder="—"
      />
    );
  }

  function sideControl(row: SheetRow) {
    const note = (
      <input
        className="al-input al-note"
        value={draft.values[row.key]?.note ?? ""}
        disabled={disabled}
        onChange={(e) => setValue(row.key, "note", e.target.value)}
        placeholder="Nota…"
      />
    );
    if (row.serialField)
      return (
        <div className="al-side-stack">
          <input
            className="al-input mono"
            value={draft.values[row.key]?.serial ?? ""}
            disabled={disabled}
            onChange={(e) => setValue(row.key, "serial", e.target.value)}
            placeholder="Matricola"
          />
          {note}
        </div>
      );
    if (!row.serials) return note;
    const c = compOf(row.serials);
    return (
      <div className="al-side-stack">
        {c ? (
          <div className="al-serials">
            {c.items.map((it) => (
              <div key={it.id} className={"al-serial" + (it.serial ? " ok" : "")}>
                <span className="al-serial-label">{it.label}</span>
                <div className="al-serial-cell">{renderSerial(it)}</div>
                <div className="al-serial-photo">{renderPhoto(it.id, `${row.label} — ${it.label}`)}</div>
              </div>
            ))}
          </div>
        ) : (
          <span className="muted small">Gruppo in creazione…</span>
        )}
        {note}
      </div>
    );
  }

  const signed = sheet?.status === "SIGNED";

  return (
    <div className="al-wrap">
      {/* Barra fissa: scheda attiva, avanzamento, azioni */}
      <div className="al-sticky">
        <div className="al-sticky-row">
          <div className="al-kinds" role="tablist">
            {SHEET_KINDS.map((k) => {
              const p = kindProgress(k);
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={k === kind}
                  className={"al-kind" + (k === kind ? " active" : "")}
                  onClick={() => setKind(k)}
                >
                  <span className="al-kind-icon">
                    <Icon name={KIND_META[k].icon} size={17} />
                  </span>
                  <span className="al-kind-text">
                    <span className="al-kind-label">
                      {KIND_META[k].label}
                      {dirty[k] && <span className="al-unsaved-dot" title="Modifiche non salvate" />}
                    </span>
                    <span className="al-kind-sub mono">
                      {sheetDef(k).code} · {sheets[k]?.status === "SIGNED" ? "firmata" : `${p}%`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="al-actions">
            <a
              className="btn-ghost-sm"
              href={`/api/machines/${machine.id}/allestimento/${kind}/pdf`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (dirty[kind] && !confirm("Ci sono modifiche non salvate: il PDF riporta i dati salvati. Aprire comunque?"))
                  e.preventDefault();
              }}
            >
              <Icon name="download" size={13} /> Stampa PDF
            </a>
            {canEdit && (
              <button
                className={"btn-primary-sm al-save" + (dirty[kind] ? " pending" : "")}
                disabled={busy || !dirty[kind]}
                onClick={() => save()}
              >
                <Icon name="check" size={13} />
                {busy ? "Salvataggio…" : dirty[kind] ? "Salva modifiche" : "Salvata"}
              </button>
            )}
          </div>
        </div>
        <div className="al-progress" aria-label={`Compilazione ${pct}%`}>
          <div className="al-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Intestazione del modulo */}
      <section className="al-hero">
        <div className="al-hero-top">
          <div>
            <div className="al-hero-code">
              {def.code} <span>· {def.rev}</span>
            </div>
            <h2 className="al-hero-title">{def.title.replace("SCHEDA ", "Scheda ").replace("ALLESTIMENTO ", "allestimento ").toLowerCase().replace(/^s/, "S")}</h2>
          </div>
          <div className={"al-status " + (signed ? "signed" : "draft")}>
            <Icon name={signed ? "check" : "sign"} size={14} />
            {signed ? "Firmata" : "In compilazione"}
          </div>
        </div>

        <div className="al-hero-grid">
          <div className="al-kv">
            <span className="al-kv-label">Commessa</span>
            <span className="al-kv-value mono">{sheetCommessa(kind, machine)}</span>
          </div>
          <div className="al-kv">
            <span className="al-kv-label">Paese destinazione</span>
            <span className="al-kv-value">{machine.country}</span>
          </div>
          <div className="al-kv">
            <span className="al-kv-label">{def.typeLabel}</span>
            {def.typeOptions ? (
              <div className="al-choice">
                {def.typeOptions.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={disabled}
                    className={"al-choice-btn type" + (draft.header.tipo === o ? " active" : "")}
                    onClick={() => setHeader("tipo", o)}
                  >
                    {o === "CONTAINER E" ? "Elettrico · E" : o === "CONTAINER D" ? "Diesel · D" : o}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="al-input"
                value={draft.header.tipo ?? ""}
                disabled={disabled}
                onChange={(e) => setHeader("tipo", e.target.value)}
                placeholder="Es. GF4000.II"
              />
            )}
          </div>
          <div className="al-kv">
            <span className="al-kv-label">Collaudato da</span>
            <input
              className="al-input"
              value={draft.header.collaudatoDa ?? ""}
              disabled={disabled}
              onChange={(e) => setHeader("collaudatoDa", e.target.value)}
              placeholder="Nome o e-mail"
            />
          </div>
        </div>

        <div className="al-hero-foot">
          <div className="al-hero-progress">
            <strong>{done}</strong>
            <span className="muted"> / {total} voci compilate</span>
            {sheet?.updatedByName && sheet.updatedAt && (
              <span className="muted small"> · salvata da {sheet.updatedByName}, {fmtDateTime(sheet.updatedAt)}</span>
            )}
          </div>
          {signed ? (
            <div className="al-signed">
              {sheet?.compilerSignature && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sheet.compilerSignature} alt="Firma" className="al-sig-img" />
              )}
              <span>
                <strong>{sheet?.compilerName}</strong>
                {sheet?.compiledAt && <span className="muted small"> · {fmtDateTime(sheet.compiledAt)}</span>}
              </span>
            </div>
          ) : (
            canSign && (
              <button className="btn-ghost-sm" disabled={busy} onClick={() => setSignOpen(true)}>
                <Icon name="sign" size={13} /> Firma scheda
              </button>
            )
          )}
        </div>
      </section>

      {/* Indice sezioni */}
      <nav className="al-jump" aria-label="Sezioni">
        {sections.map(({ s, rows, done: d }) => (
          <button
            key={s.key}
            className={"al-jump-chip" + (d === rows.length ? " done" : "")}
            onClick={() => {
              setClosed((c) => ({ ...c, [`${kind}.${s.key}`]: false }));
              setTimeout(() => document.getElementById(`al-${kind}-${s.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }}
          >
            <Icon name={s.icon} size={13} />
            {s.title.replace("ALLESTIMENTO ", "").toLowerCase()}
            <span className="al-jump-n">
              {d}/{rows.length}
            </span>
          </button>
        ))}
      </nav>

      {sections.map(({ s, rows, done: d }) => {
        const id = `${kind}.${s.key}`;
        const isOpen = !closed[id];
        const complete = d === rows.length;
        return (
          <section key={s.key} id={`al-${kind}-${s.key}`} className={"al-sec" + (complete ? " complete" : "")}>
            <button className="al-sec-head" onClick={() => setClosed((c) => ({ ...c, [id]: isOpen }))} aria-expanded={isOpen}>
              <span className="al-sec-icon">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="al-sec-titles">
                <span className="al-sec-title">{s.title}</span>
                {s.subtitle && <span className="al-sec-sub">{s.subtitle}</span>}
              </span>
              <span className="al-sec-meter">
                <span className="al-sec-meter-bar" style={{ width: `${rows.length ? (d / rows.length) * 100 : 0}%` }} />
              </span>
              <span className={"al-count" + (complete ? " done" : "")}>
                {complete && <Icon name="check" size={12} />}
                {d}/{rows.length}
              </span>
              <Icon name={isOpen ? "chev-down" : "chev-right"} size={16} />
            </button>

            {isOpen && (
              <div className="al-rows">
                <div className="al-row al-row-head" aria-hidden>
                  <span>Voce</span>
                  <span>Specifica</span>
                  <span>Matricola · Foto · Note</span>
                </div>
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className={
                      "al-row" +
                      (filled(draft.values[row.key]?.spec) ? " filled" : "") +
                      (row.serials ? " has-serials" : "")
                    }
                  >
                    <div className="al-row-label">
                      <span className="al-dot" />
                      <span>
                        {row.label}
                        {row.bind && (
                          <span className="al-linked" title="Dato del gruppo componente, condiviso con l'elenco per gruppo">
                            componente
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="al-row-spec">{specControl(row)}</div>
                    <div className="al-row-side">{sideControl(row)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {signOpen && (
        <SignSheetModal
          title={`${def.code} · ${KIND_META[kind].label}`}
          hasSavedSignature={hasSavedSignature}
          onClose={() => setSignOpen(false)}
          onSign={async (body) => {
            if (dirty[kind] && !(await save(true))) return false;
            const res = await fetch(`/api/machines/${machine.id}/allestimento`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind, action: "sign", ...body }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
              notify(d.error || "Errore nella firma", "err");
              return false;
            }
            setSignOpen(false);
            notify("Scheda firmata");
            await load();
            onDone();
            return true;
          }}
        />
      )}
    </div>
  );
}

/**
 * Campo a elenco: si sceglie una voce o se ne scrive una nuova e la si aggiunge
 * all'elenco con un clic, così la volta dopo è già fra le scelte.
 */
function Combobox({
  value,
  options,
  custom,
  disabled,
  canRemove,
  onChange,
  onAdd,
  onRemove,
}: {
  value: string;
  options: string[];
  custom: string[];
  disabled: boolean;
  canRemove: boolean;
  onChange: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = value.trim().toUpperCase();
  const exact = options.some((o) => o.toUpperCase() === q);
  // Con un valore già in elenco si mostrano tutte le voci, per poter cambiare.
  const shown = q && !exact ? options.filter((o) => o.toUpperCase().includes(q)) : options;
  const canAddTyped = !!q && !exact;
  const customUp = custom.map((c) => c.toUpperCase());

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setHi(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const count = shown.length + (canAddTyped ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h + 1) % Math.max(count, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => (h <= 0 ? count - 1 : h - 1));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (hi >= 0 && hi < shown.length) pick(shown[hi]);
      else if (canAddTyped && (hi === shown.length || shown.length === 0)) {
        onAdd(value.trim());
        setOpen(false);
      } else setOpen(false);
    } else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className={"al-combo" + (open ? " open" : "")}>
      <input
        ref={inputRef}
        className="al-input"
        value={value}
        disabled={disabled}
        placeholder={options[0] ? `Es. ${options[0]}` : "Scrivi o scegli…"}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHi(-1);
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        tabIndex={-1}
        className="al-combo-toggle"
        disabled={disabled}
        aria-label="Mostra elenco"
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
          inputRef.current?.focus();
        }}
      >
        <Icon name="chev-down" size={14} />
      </button>

      {open && !disabled && (
        <div className="al-combo-menu" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {shown.map((o, i) => {
            const isCustom = customUp.includes(o.toUpperCase());
            const selected = o.toUpperCase() === q;
            return (
              <div
                key={o}
                role="option"
                aria-selected={selected}
                className={"al-combo-opt" + (i === hi ? " hi" : "") + (selected ? " selected" : "")}
                onClick={() => pick(o)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="al-combo-check">{selected && <Icon name="check" size={13} />}</span>
                <span className="al-combo-text">{o}</span>
                {isCustom && <span className="al-combo-tag">aggiunta</span>}
                {isCustom && canRemove && (
                  <button
                    type="button"
                    className="al-combo-del"
                    title="Togli dall'elenco"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(o);
                    }}
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {!shown.length && !canAddTyped && (
            <div className="al-combo-empty">Elenco vuoto: scrivi una voce e aggiungila</div>
          )}
          {canAddTyped && (
            <div
              className={"al-combo-add" + (hi === shown.length ? " hi" : "")}
              onClick={() => {
                onAdd(value.trim());
                setOpen(false);
              }}
              onMouseEnter={() => setHi(shown.length)}
            >
              <Icon name="plus" size={13} /> Aggiungi <strong>«{value.trim()}»</strong> all&apos;elenco
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignSheetModal({
  title,
  hasSavedSignature,
  onClose,
  onSign,
}: {
  title: string;
  hasSavedSignature: boolean;
  onClose: () => void;
  onSign: (body: { signature?: string; saveSignature?: boolean }) => Promise<boolean>;
}) {
  const [useSaved, setUseSaved] = useState(hasSavedSignature);
  const [saveSig, setSaveSig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  async function confirmSign() {
    setErr(null);
    let body: { signature?: string; saveSignature?: boolean } = {};
    if (!useSaved) {
      if (sigRef.current?.isEmpty()) return setErr("Disegna la firma prima di confermare.");
      body = { signature: sigRef.current?.toDataURL(), saveSignature: saveSig };
    }
    setBusy(true);
    await onSign(body);
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Firma scheda {title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            Firmi come compilatore: data e firma finiscono nel PDF della scheda. Se la scheda viene modificata dopo,
            la firma decade.
          </p>
          {hasSavedSignature && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input type="checkbox" checked={useSaved} onChange={(e) => setUseSaved(e.target.checked)} />
              Usa la mia firma personale salvata
            </label>
          )}
          {!useSaved && (
            <>
              <SignaturePad ref={sigRef} height={150} />
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <input type="checkbox" checked={saveSig} onChange={(e) => setSaveSig(e.target.checked)} />
                Salva come firma personale
              </label>
            </>
          )}
          {err && <div className="form-error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button className="btn-primary" onClick={confirmSign} disabled={busy}>
            {busy ? "Firma…" : "Firma e salva"}
          </button>
        </div>
      </div>
    </div>
  );
}
