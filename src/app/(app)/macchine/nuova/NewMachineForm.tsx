"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import CustomerPicker, { type CustomerHit } from "@/components/CustomerPicker";
import { COUNTRIES } from "@/lib/domain";
import { hasDualJob, CUSTOM_MODEL } from "@/lib/plant";

type PlantConfig = { name: string; models: string[] }[];

// Il fascicolo nasce con i dati minimi: targa tecnica, componenti e matricole
// si compilano dopo, dalla scheda della macchina.
const STEPS = ["Identificazione", "Cliente"];

export default function NewMachineForm({
  plantConfig,
  redirectBase = "/macchine",
  canCreateCustomer = false,
}: {
  plantConfig: PlantConfig;
  redirectBase?: string;
  /** Se true mostra il pulsante per creare al volo un cliente in anagrafica. */
  canCreateCustomer?: boolean;
}) {
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

  const [f, setF] = useState({
    job: "",
    jobBody: "",
    jobContainer: "",
    year,
    plantType: PLANT_TYPES[0] as string,
    model: modelsForPlant(PLANT_TYPES[0])[0],
    customModel: "",
    customer: "",
    customerId: "",
    countryCode: "IT",
    site: "",
    productionStart: new Date().toISOString().slice(0, 10),
    deliveryDate: "",
  });
  const set = (k: string, v: string | number) => setF((s) => ({ ...s, [k]: v }));

  // Cliente selezionato dall'anagrafica (Customer): serve il collegamento
  // `customerId`, altrimenti il fascicolo non compare tra le macchine del
  // cliente negli interventi di service.
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [newCust, setNewCust] = useState<null | { name: string; city: string; countryCode: string }>(
    null
  );

  function pickCustomer(c: CustomerHit | null) {
    setSites(c?.sites ?? []);
    setF((s) => ({
      ...s,
      customer: c?.name ?? "",
      customerId: c?.id ?? "",
      countryCode: c?.countryCode && c.countryCode !== "XX" ? c.countryCode : s.countryCode,
      site: "",
    }));
  }

  async function createCustomer() {
    if (!newCust?.name.trim()) return setErr("La ragione sociale del cliente è obbligatoria.");
    setBusy(true);
    setErr("");
    const country = COUNTRIES.find((c) => c.code === newCust.countryCode);
    const res = await fetch("/api/clienti", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newCust.name.trim(),
        city: newCust.city.trim(),
        country: country?.label || "Italia",
      }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Errore creazione cliente");
    setSites([]);
    setF((s) => ({
      ...s,
      customer: newCust.name.trim(),
      customerId: d.id,
      countryCode: newCust.countryCode,
      site: "",
    }));
    setNewCust(null);
  }
  const setPlant = (pt: string) =>
    setF((s) => ({ ...s, plantType: pt, model: modelsForPlant(pt)[0], customModel: "" }));
  const modelOptions = modelsForPlant(f.plantType);

  async function submit() {
    setErr("");
    if (!f.job.trim()) {
      setStep(0);
      return setErr("Il Job number è obbligatorio.");
    }
    if (!f.customerId) {
      setStep(1);
      return setErr(
        "Seleziona il cliente dall'anagrafica: senza collegamento il fascicolo non comparirà tra le macchine del cliente."
      );
    }
    const resolvedModel =
      f.model === CUSTOM_MODEL ? f.customModel.trim() : f.model;
    if (!resolvedModel) {
      setStep(0);
      return setErr("Specifica il modello.");
    }
    setBusy(true);
    const country = COUNTRIES.find((c) => c.code === f.countryCode);
    const res = await fetch("/api/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        model: resolvedModel,
        country: country?.label || "Italia",
      }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      router.push(`${redirectBase}/${d.code}`);
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
          <p>
            Bastano identificazione e cliente. Targa tecnica, componenti e matricole si
            compilano dopo, dalla scheda della macchina.
          </p>
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
            <div className="form-row" style={{ gridColumn: "1 / -1" }}>
              <label>Cliente * — dall'anagrafica clienti</label>
              <CustomerPicker currentName={f.customer || null} onPick={pickCustomer} />
              <div className="muted small" style={{ marginTop: 5 }}>
                {f.customerId ? (
                  <>
                    <Icon name="check" size={12} /> Collegato all'anagrafica: gli interventi di
                    service vedranno questa macchina tra quelle del cliente.
                  </>
                ) : (
                  <>
                    Il cliente va <strong>scelto dall'elenco</strong>, non scritto a mano.
                    {canCreateCustomer && " Se non è ancora censito, creane la scheda."}
                  </>
                )}
              </div>
              {canCreateCustomer && !newCust && !f.customerId && (
                <button
                  type="button"
                  className="btn-ghost-sm"
                  style={{ marginTop: 8, alignSelf: "flex-start" }}
                  onClick={() => setNewCust({ name: "", city: "", countryCode: f.countryCode })}
                >
                  <Icon name="plus" size={13} /> Nuovo cliente in anagrafica
                </button>
              )}
              {canCreateCustomer && newCust && (
                <div className="card" style={{ marginTop: 10, padding: 12 }}>
                  <div className="form-grid">
                    <div className="form-row">
                      <label>Ragione sociale *</label>
                      <input
                        className="input"
                        value={newCust.name}
                        onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                        placeholder="es. NORD METAL RECYCLING GmbH"
                      />
                    </div>
                    <div className="form-row">
                      <label>Città</label>
                      <input
                        className="input"
                        value={newCust.city}
                        onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}
                      />
                    </div>
                    <div className="form-row">
                      <label>Paese</label>
                      <select
                        className="input"
                        value={newCust.countryCode}
                        onChange={(e) => setNewCust({ ...newCust, countryCode: e.target.value })}
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn-ghost-sm" type="button" onClick={() => setNewCust(null)}>
                      Annulla
                    </button>
                    <button
                      className="btn-primary-sm"
                      type="button"
                      disabled={busy}
                      onClick={createCustomer}
                    >
                      <Icon name="check" size={13} /> Crea e seleziona
                    </button>
                  </div>
                </div>
              )}
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
              {sites.length > 0 && (
                <select
                  className="input"
                  style={{ marginBottom: 6 }}
                  value={sites.some((x) => x.name === f.site) ? f.site : ""}
                  onChange={(e) => set("site", e.target.value)}
                >
                  <option value="">— Cantiere del cliente / altro —</option>
                  {sites.map((x) => (
                    <option key={x.id} value={x.name}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
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
