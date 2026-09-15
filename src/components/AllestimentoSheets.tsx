"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/Icon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  SHEET_KINDS,
  YES_NO,
  YES_NO_NA,
  sheetCommessa,
  sheetCtx,
  sheetDef,
  visibleRows,
  type SheetHeader,
  type SheetKind,
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

const TAB_LABEL: Record<SheetKind, string> = { TRITURATORE: "Trituratore", CONTAINER: "Container" };

/**
 * Schede di allestimento BLUE DEVIL dentro Componenti & Matricole. Le matricole
 * e le foto usano le stesse celle dell'elenco componenti (render props), così
 * OCR, diario e foto per slot restano un solo flusso.
 */
export default function AllestimentoSheets({
  machine,
  canEdit,
  canSign,
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
  hasSavedSignature: boolean;
  renderSerial: (item: Item) => ReactNode;
  renderPhoto: (itemId: string, title: string) => ReactNode;
  onDone: () => void;
  notify: (m: string, k?: "ok" | "err") => void;
}) {
  const [kind, setKind] = useState<SheetKind>("TRITURATORE");
  const [sheets, setSheets] = useState<Record<string, SheetDTO> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { header: SheetHeader; values: SheetValues }>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
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

  if (loadErr) return <div className="form-error">{loadErr}</div>;
  if (!sheets || !draft) return <div className="muted" style={{ padding: 16 }}>Caricamento schede di allestimento…</div>;

  const compOf = (groupId: string) => machine.components.find((c) => c.groupId === groupId);

  function specInput(row: SheetRow) {
    const val = draft.values[row.key]?.spec ?? "";
    const disabled = !canEdit || busy;
    if (row.input === "yesno" || row.input === "yesnona" || row.input === "select") {
      const opts = row.input === "yesno" ? YES_NO : row.input === "yesnona" ? YES_NO_NA : row.options ?? [];
      return (
        <select value={val} disabled={disabled} onChange={(e) => setValue(row.key, "spec", e.target.value)}>
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {val && !opts.includes(val) && <option value={val}>{val}</option>}
        </select>
      );
    }
    const listId = row.suggest ? `al-${kind}-${row.key}` : undefined;
    return (
      <>
        <input
          value={val}
          disabled={disabled}
          list={listId}
          onChange={(e) => setValue(row.key, "spec", e.target.value)}
          placeholder={row.suggest?.[0] ?? ""}
        />
        {listId && (
          <datalist id={listId}>
            {row.suggest!.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  function serialCell(row: SheetRow) {
    if (row.wide) return null;
    if (row.serialField)
      return (
        <input
          className="mono"
          value={draft.values[row.key]?.serial ?? ""}
          disabled={!canEdit || busy}
          onChange={(e) => setValue(row.key, "serial", e.target.value)}
          placeholder="Matricola"
        />
      );
    if (!row.serials) return null;
    const c = compOf(row.serials);
    if (!c) return <span className="muted small">Gruppo in creazione…</span>;
    return (
      <div className="al-serials">
        {c.items.map((it) => (
          <div key={it.id} className="al-serial">
            <span className="al-serial-label muted small">{it.label}</span>
            <div className="al-serial-cell">{renderSerial(it)}</div>
            <div className="al-serial-photo">{renderPhoto(it.id, `${row.label} — ${it.label}`)}</div>
          </div>
        ))}
      </div>
    );
  }

  const filledCount = def.sections
    .flatMap((s) => visibleRows(s, ctx))
    .filter((r) => (draft.values[r.key]?.spec ?? "").trim()).length;
  const totalCount = def.sections.flatMap((s) => visibleRows(s, ctx)).length;

  return (
    <div className="al-wrap">
      <div className="al-toolbar">
        <div className="seg-tabs">
          {SHEET_KINDS.map((k) => (
            <button key={k} className={"seg-tab" + (k === kind ? " active" : "")} onClick={() => setKind(k)}>
              {TAB_LABEL[k]} <span className="mono">{sheetDef(k).code}</span>
              {sheets[k]?.status === "SIGNED" && <Icon name="check" size={13} />}
              {dirty[k] && <span title="Modifiche non salvate">•</span>}
            </button>
          ))}
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
            <button className="btn-primary-sm" disabled={busy || !dirty[kind]} onClick={() => save()}>
              {busy ? "Salvataggio…" : "Salva scheda"}
            </button>
          )}
        </div>
      </div>

      <section className="card al-head">
        <div className="al-head-grid">
          <div>
            <span className="field-label">Commessa</span>
            <div className="mono">{sheetCommessa(kind, machine)}</div>
          </div>
          <div>
            <span className="field-label">Paese destinazione</span>
            <div>{machine.country}</div>
          </div>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">{def.typeLabel}</span>
            {def.typeOptions ? (
              <select
                value={draft.header.tipo ?? ""}
                disabled={!canEdit || busy}
                onChange={(e) => setHeader("tipo", e.target.value)}
              >
                {def.typeOptions.map((o) => (
                  <option key={o} value={o}>
                    {o === "CONTAINER E" ? "CONTAINER E (elettrico)" : o === "CONTAINER D" ? "CONTAINER D (diesel)" : o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.header.tipo ?? ""}
                disabled={!canEdit || busy}
                onChange={(e) => setHeader("tipo", e.target.value)}
                placeholder="Es. GF4000.II"
              />
            )}
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Collaudato da</span>
            <input
              value={draft.header.collaudatoDa ?? ""}
              disabled={!canEdit || busy}
              onChange={(e) => setHeader("collaudatoDa", e.target.value)}
            />
          </label>
        </div>
        <div className="al-sign-row">
          <span className="muted small">
            Specifiche compilate <strong>{filledCount}</strong> / {totalCount}
            {sheet?.updatedByName && sheet.updatedAt && (
              <> · ultimo salvataggio {sheet.updatedByName}, {fmtDateTime(sheet.updatedAt)}</>
            )}
          </span>
          {sheet?.status === "SIGNED" ? (
            <span className="al-signed">
              <Icon name="check" size={14} /> Firmata da <strong>{sheet.compilerName}</strong>
              {sheet.compiledAt && <> il {fmtDateTime(sheet.compiledAt)}</>}
              {sheet.compilerSignature && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sheet.compilerSignature} alt="Firma" className="al-sig-img" />
              )}
            </span>
          ) : (
            canSign && (
              <button className="btn-ghost-sm" disabled={busy} onClick={() => setSignOpen(true)}>
                <Icon name="sign" size={13} /> Firma scheda
              </button>
            )
          )}
        </div>
      </section>

      {def.sections.map((section) => {
        const rows = visibleRows(section, ctx);
        if (!rows.length) return null;
        return (
          <section key={section.key} className="card al-section">
            <div className="al-section-title">
              <h3>{section.title}</h3>
              {section.subtitle && <span className="muted small">{section.subtitle}</span>}
            </div>
            <div className="table-wrap">
              <table className="cmp-table al-table">
                <thead>
                  <tr>
                    <th style={{ width: "26%" }}>Voce</th>
                    <th style={{ width: "22%" }}>Specifica</th>
                    <th>Matricola</th>
                    <th style={{ width: "20%" }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {row.label}
                        {row.bind && <span className="al-linked" title="Dato del gruppo componente, condiviso con l'elenco componenti">componente</span>}
                      </td>
                      <td colSpan={row.wide ? 2 : 1}>{specInput(row)}</td>
                      {!row.wide && <td>{serialCell(row)}</td>}
                      <td>
                        <input
                          value={draft.values[row.key]?.note ?? ""}
                          disabled={!canEdit || busy}
                          onChange={(e) => setValue(row.key, "note", e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {signOpen && (
        <SignSheetModal
          title={`${def.code} · ${TAB_LABEL[kind]}`}
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
