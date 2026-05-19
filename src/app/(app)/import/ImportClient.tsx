"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

type Preview = {
  total: number;
  errors: string[];
  preview: { job: string; year: number; customer: string; country: string; serials: number }[];
};

const MODELLI = [
  "Da definire",
  "ZSR 2200 / Trituratore primario",
  "ZSR 1800 / Compatto",
  "ZSR 3000 / Heavy Duty",
  "ZSR 1500 / Mobile",
  "ZSR 2500 / Bialbero",
];

export default function ImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState(MODELLI[0]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function send(commit: boolean) {
    if (!file) return setErr("Seleziona un file Excel/CSV");
    setErr("");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("model", model);
    if (commit) fd.append("commit", "1");
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error || "Errore import");
    if (commit) {
      setResult(
        `Import completato: ${d.created} create, ${d.skipped} già presenti su ${d.total} righe.`
      );
      setPreview(null);
      router.refresh();
    } else {
      setPreview(d);
      setResult(null);
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Import Excel / CSV</h1>
          <p>
            Caricamento massivo macchine dal file <span className="mono">FILE MATRICOLE</span>{" "}
            (intestazioni a 2 righe, dati dalla riga 3).
          </p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        {err && <div className="form-error" style={{ marginBottom: 14 }}>{err}</div>}
        {result && <div className="form-ok" style={{ marginBottom: 14 }}>{result}</div>}

        <div className="form-row" style={{ marginBottom: 16, maxWidth: 320 }}>
          <label>Modello da assegnare alle macchine importate</label>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELLI.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>

        <div
          className={"upload-zone" + (drag ? " drag" : "")}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const ff = e.dataTransfer.files?.[0];
            if (ff) {
              setFile(ff);
              setPreview(null);
            }
          }}
        >
          <Icon name="upload" size={28} />
          <div>
            {file ? (
              <strong>{file.name}</strong>
            ) : (
              "Trascina qui il file .xlsx / .csv o clicca per selezionarlo"
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
              setResult(null);
            }}
          />
        </div>

        <div className="row-actions" style={{ marginTop: 16 }}>
          <button className="btn-ghost" disabled={busy || !file} onClick={() => send(false)}>
            <Icon name="search" size={14} /> Analizza (anteprima)
          </button>
          <button
            className="btn-primary"
            disabled={busy || !preview}
            onClick={() => send(true)}
          >
            <Icon name="check" size={14} /> {busy ? "Importo…" : "Conferma import"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
          <div className="card-header">
            <h3>Anteprima — {preview.total} macchine rilevate</h3>
          </div>
          {preview.errors.length > 0 && (
            <div className="form-error" style={{ marginBottom: 12 }}>
              {preview.errors.slice(0, 5).map((e, i) => (
                <div key={i}>{e}</div>
              ))}
              {preview.errors.length > 5 && <div>… e altri {preview.errors.length - 5}</div>}
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Anno</th>
                  <th>Cliente</th>
                  <th>Paese</th>
                  <th>Matricole</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.job}</td>
                    <td className="mono">{p.year}</td>
                    <td>{p.customer}</td>
                    <td>{p.country}</td>
                    <td className="mono">{p.serials}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Mostrate le prime {preview.preview.length} di {preview.total}. Le righe con job
            già presente (stesso anno) saranno saltate.
          </p>
        </div>
      )}
    </div>
  );
}
