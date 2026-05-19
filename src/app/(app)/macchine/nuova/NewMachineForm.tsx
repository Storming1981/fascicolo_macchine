"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import { COMPONENT_GROUPS } from "@/lib/components";
import { COUNTRIES } from "@/lib/domain";
import { hasDualJob, CUSTOM_MODEL } from "@/lib/plant";

type CompState = Record<
  string,
  { brand: string; items: string[]; extra: Record<string, string> }
>;

type PlantConfig = { name: string; models: string[] }[];

const STEPS = ["Identificazione", "Cliente", "Targa tecnica", "Componenti"];

export default function NewMachineForm({ plantConfig }: { plantConfig: PlantConfig }) {
  const router = useRouter();
  const PLANT_TYPES = plantConfig.map((p) => p.name);
  const modelsForPlant = (pt: string) => [
    ...(plantConfig.find((p) => p.name === pt)?.models ?? []),
    CUSTOM_MODEL,
  ];
  const year = new Date().getFullYear();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(COMPONENT_GROUPS[0].id);

  const [f, setF] = useState({
    job: "",
    jobBody: "",
    jobContainer: "",
    year,
    plantType: PLANT_TYPES[0] as string,
    model: modelsForPlant(PLANT_TYPES[0])[0],
    customModel: "",
    customer: "",
    countryCode: "IT",
    site: "",
    productionStart: new Date().toISOString().slice(0, 10),
    deliveryDate: "",
    plateWeight: "",
    platePower: "",
    plateVoltage: "400V / 50Hz",
    pressureSettings: "",
  });
  const set = (k: string, v: string | number) => setF((s) => ({ ...s, [k]: v }));
  const setPlant = (pt: string) =>
    setF((s) => ({ ...s, plantType: pt, model: modelsForPlant(pt)[0], customModel: "" }));
  const modelOptions = modelsForPlant(f.plantType);

  const [comp, setComp] = useState<CompState>(
    Object.fromEntries(
      COMPONENT_GROUPS.map((g) => [
        g.id,
        {
          brand: "",
          items: g.slots.map(() => ""),
          extra: Object.fromEntries((g.extra || []).map((e) => [e.key, ""])),
        },
      ])
    )
  );

  function setCB(id: string, brand: string) {
    setComp((s) => ({ ...s, [id]: { ...s[id], brand } }));
  }
  function setCI(id: string, i: number, v: string) {
    setComp((s) => {
      const items = [...s[id].items];
      items[i] = v;
      return { ...s, [id]: { ...s[id], items } };
    });
  }
  function setCE(id: string, key: string, v: string) {
    setComp((s) => ({ ...s, [id]: { ...s[id], extra: { ...s[id].extra, [key]: v } } }));
  }

  async function submit() {
    setErr("");
    if (!f.job.trim() || !f.customer.trim()) {
      setStep(!f.job.trim() ? 0 : 1);
      return setErr("Job number e cliente sono obbligatori.");
    }
    const resolvedModel =
      f.model === CUSTOM_MODEL ? f.customModel.trim() : f.model;
    if (!resolvedModel) {
      setStep(0);
      return setErr("Specifica il modello.");
    }
    setBusy(true);
    const country = COUNTRIES.find((c) => c.code === f.countryCode);
    const components = COMPONENT_GROUPS.map((g) => {
      const c = comp[g.id];
      return {
        groupId: g.id,
        brand: c.brand || null,
        items: g.slots.map((label, position) => ({
          position,
          label,
          serial: c.items[position] || null,
        })),
        extra: Object.keys(c.extra).length
          ? Object.fromEntries(Object.entries(c.extra).filter(([, v]) => v))
          : null,
      };
    });
    const res = await fetch("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        model: resolvedModel,
        country: country?.label || "Italia",
        components,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      router.push(`/macchine/${d.code}`);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Errore creazione fascicolo");
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Nuova macchina</h1>
          <p>Crea il fascicolo tecnico. Tutti i campi saranno modificabili in seguito.</p>
        </div>
        <Link className="btn-ghost" href="/macchine">
          <Icon name="x" size={15} /> Annulla
        </Link>
      </div>

      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={
              "wizard-step" + (i === step ? " active" : "") + (i < step ? " done" : "")
            }
            onClick={() => i <= step && setStep(i)}
          >
            <span className="wizard-num">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      {err && <div className="form-error" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="card wizard-body">
        {step === 0 && (
          <div className="form-grid">
            <div className="form-row">
              <label>Anno</label>
              <input
                className="input mono"
                type="number"
                value={f.year}
                onChange={(e) => set("year", Number(e.target.value))}
              />
            </div>
            <div className="form-row">
              <label>Tipologia impianto *</label>
              <select
                className="input"
                value={f.plantType}
                onChange={(e) => setPlant(e.target.value)}
              >
                {PLANT_TYPES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Modello *</label>
              <select
                className="input"
                value={f.model}
                onChange={(e) => set("model", e.target.value)}
              >
                {modelOptions.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            {f.model === CUSTOM_MODEL && (
              <div className="form-row">
                <label>Modello personalizzato *</label>
                <input
                  className="input"
                  value={f.customModel}
                  onChange={(e) => set("customModel", e.target.value)}
                  placeholder="Inserisci il modello"
                />
              </div>
            )}
            <div className="form-row">
              <label>Job Number — commessa di vendita *</label>
              <input
                className="input mono"
                value={f.job}
                onChange={(e) => set("job", e.target.value)}
                placeholder="es. 1260200"
              />
            </div>
            <div className="form-row">
              <label>
                Job Body{hasDualJob(f.plantType) ? " — corpo trituratore" : ""}
              </label>
              <input
                className="input mono"
                value={f.jobBody}
                onChange={(e) => set("jobBody", e.target.value)}
                placeholder="Ordine / commessa corpo"
              />
            </div>
            <div className="form-row">
              <label>
                Job Container{hasDualJob(f.plantType) ? " — container" : ""}
              </label>
              <input
                className="input mono"
                value={f.jobContainer}
                onChange={(e) => set("jobContainer", e.target.value)}
                placeholder="Ordine / commessa container"
              />
            </div>
            {hasDualJob(f.plantType) && (
              <div className="form-ok" style={{ gridColumn: "1 / -1" }}>
                Un impianto <strong>BLUE DEVIL</strong> si compone di{" "}
                <strong>corpo trituratore</strong> (Job Body) e{" "}
                <strong>container</strong> (Job Container): indica entrambi i
                riferimenti di commessa/ordine.
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="form-grid">
            <div className="form-row">
              <label>Cliente *</label>
              <input
                className="input"
                value={f.customer}
                onChange={(e) => set("customer", e.target.value)}
                placeholder="es. NORD METAL RECYCLING GmbH"
              />
            </div>
            <div className="form-row">
              <label>Paese *</label>
              <select
                className="input"
                value={f.countryCode}
                onChange={(e) => set("countryCode", e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Sito di installazione</label>
              <input
                className="input"
                value={f.site}
                onChange={(e) => set("site", e.target.value)}
                placeholder="es. Hannover, DE"
              />
            </div>
            <div className="form-row">
              <label>Inizio produzione</label>
              <input
                className="input"
                type="date"
                value={f.productionStart}
                onChange={(e) => set("productionStart", e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Data consegna prevista</label>
              <input
                className="input"
                type="date"
                value={f.deliveryDate}
                onChange={(e) => set("deliveryDate", e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="form-grid">
            <div className="form-row">
              <label>Peso totale</label>
              <input
                className="input"
                value={f.plateWeight}
                onChange={(e) => set("plateWeight", e.target.value)}
                placeholder="38 500 kg"
              />
            </div>
            <div className="form-row">
              <label>Potenza nominale</label>
              <input
                className="input"
                value={f.platePower}
                onChange={(e) => set("platePower", e.target.value)}
                placeholder="450 kW"
              />
            </div>
            <div className="form-row">
              <label>Tensione / Frequenza</label>
              <select
                className="input"
                value={f.plateVoltage}
                onChange={(e) => set("plateVoltage", e.target.value)}
              >
                <option>400V / 50Hz</option>
                <option>480V / 60Hz</option>
                <option>690V / 50Hz</option>
                <option>380V / 50Hz</option>
              </select>
            </div>
            <div className="form-row">
              <label>Settaggi pressione</label>
              <input
                className="input mono"
                value={f.pressureSettings}
                onChange={(e) => set("pressureSettings", e.target.value)}
                placeholder="255 bar + 3/4 giro (320 bar)"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="muted small" style={{ marginBottom: 14 }}>
              Inserisci brand e matricole disponibili. Gli slot vuoti si completano in
              produzione.
            </p>
            {COMPONENT_GROUPS.map((g) => {
              const c = comp[g.id];
              const isOpen = open === g.id;
              const filled = c.items.filter((x) => x.trim()).length;
              return (
                <div key={g.id} className="cmp-edit-row">
                  <button
                    className="cmp-row-head"
                    type="button"
                    onClick={() => setOpen(isOpen ? null : g.id)}
                  >
                    <span className="cmp-icon">
                      <Icon name={g.icon} size={20} />
                    </span>
                    <div className="cmp-name">
                      <div className="cmp-label">{g.label}</div>
                      <div className="cmp-en mono">{g.en}</div>
                    </div>
                    <div className="cmp-brand">{c.brand || "—"}</div>
                    <div className="cmp-count">
                      <span
                        className={
                          "cmp-count-pill " +
                          (filled === g.slots.length && filled > 0
                            ? "full"
                            : filled > 0
                            ? "partial"
                            : "")
                        }
                      >
                        {filled} / {g.slots.length}
                      </span>
                    </div>
                    <Icon name={isOpen ? "chev-down" : "chev-right"} size={16} />
                  </button>
                  {isOpen && (
                    <div className="cmp-edit-body">
                      <div className="form-row" style={{ maxWidth: 320, marginBottom: 12 }}>
                        <label>Fornitore / Brand</label>
                        <input
                          className="input"
                          value={c.brand}
                          onChange={(e) => setCB(g.id, e.target.value)}
                          placeholder="es. DINAMIC OIL"
                        />
                      </div>
                      <div className="nm-slots">
                        {g.slots.map((slot, i) => (
                          <div className="form-row" key={i}>
                            <label>{slot}</label>
                            <input
                              className="input mono"
                              value={c.items[i]}
                              onChange={(e) => setCI(g.id, i, e.target.value)}
                              placeholder="Matricola / S.N."
                            />
                          </div>
                        ))}
                        {(g.extra || []).map((ex) => (
                          <div className="form-row" key={ex.key}>
                            <label>{ex.label}</label>
                            <input
                              className="input mono"
                              value={c.extra[ex.key] || ""}
                              onChange={(e) => setCE(g.id, ex.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="wizard-foot">
          {step > 0 ? (
            <button className="btn-ghost" onClick={() => setStep((s) => s - 1)}>
              <Icon name="arrow-left" size={14} /> Indietro
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              Avanti <Icon name="arrow-right" size={14} />
            </button>
          ) : (
            <button className="btn-success" disabled={busy} onClick={submit}>
              <Icon name="check" size={14} /> {busy ? "Creo…" : "Crea fascicolo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
