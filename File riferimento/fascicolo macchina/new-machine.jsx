// New Machine Wizard — 5 step form
const NM_GROUPS = window.APP_DATA.COMPONENT_GROUPS;

const STEP_META = [
  { id: 'id',         label: 'Identificazione',  icon: 'doc',     desc: 'Job number, modello e anno' },
  { id: 'cliente',    label: 'Cliente',           icon: 'pin',     desc: 'Destinatario e date' },
  { id: 'targa',      label: 'Targa tecnica',     icon: 'bolt',    desc: 'Potenza, pressione, dimensioni' },
  { id: 'componenti', label: 'Componenti',        icon: 'gear',    desc: 'Brand e matricole' },
  { id: 'riepilogo',  label: 'Riepilogo',         icon: 'check',   desc: 'Verifica e conferma' },
];

const MODELLI = [
  'ZSR 2200 / Trituratore primario',
  'ZSR 1800 / Compatto',
  'ZSR 3000 / Heavy Duty',
  'ZSR 1500 / Mobile',
  'ZSR 2500 / Bialbero',
  'Altro / Personalizzato',
];

const PAESI = [
  { code: 'DE', label: 'Germania' }, { code: 'IT', label: 'Italia' },
  { code: 'ES', label: 'Spagna' }, { code: 'FR', label: 'Francia' },
  { code: 'SE', label: 'Svezia' }, { code: 'NO', label: 'Norvegia' },
  { code: 'FI', label: 'Finlandia' }, { code: 'IS', label: 'Islanda' },
  { code: 'US', label: 'USA' }, { code: 'GB', label: 'UK' },
  { code: 'AT', label: 'Austria' }, { code: 'NL', label: 'Olanda' },
  { code: 'PL', label: 'Polonia' }, { code: 'CH', label: 'Svizzera' },
];

// Auto-generate next ID
const genId = () => {
  const year = new Date().getFullYear();
  const existing = window.APP_DATA.MACHINES.filter(m => m.year === year).length;
  return `M-${year}-${String(existing + 1).padStart(4, '0')}`;
};
const genJob = () => {
  const yr = String(new Date().getFullYear()).slice(2);
  return `1${yr}${String(Math.floor(Math.random() * 9000) + 1000).padStart(4,'0')}`;
};

const INIT_FORM = {
  // Step 1
  id: genId(),
  job: genJob(),
  jobBody: '',
  jobContainer: '',
  anno: new Date().getFullYear(),
  modello: MODELLI[0],
  // Step 2
  customer: '',
  countryCode: 'DE',
  site: '',
  productionStart: new Date().toISOString().slice(0, 10),
  deliveryDate: '',
  // Step 3
  weight: '',
  power: '',
  voltage: '400V / 50Hz',
  pressure: '',
  // Step 4 – componenti: flat map brand+items per group
  components: Object.fromEntries(
    NM_GROUPS.map(g => [g.id, { brand: '', items: Array(g.slots.length).fill(''), extra: g.extra ? Object.fromEntries(Object.keys(g.extra).map(k => [k, ''])) : undefined }])
  ),
};

const NewMachineView = ({ onClose, onSave }) => {
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState(INIT_FORM);
  const [openGroup, setOpenGroup] = React.useState('gearboxes');
  const [saved, setSaved] = React.useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setComp = (groupId, field, val, idx = null) => {
    setForm(f => {
      const g = { ...f.components[groupId] };
      if (field === 'brand') g.brand = val;
      else if (field === 'item') { const items = [...g.items]; items[idx] = val; g.items = items; }
      else if (field === 'extra') { g.extra = { ...g.extra, ...val }; }
      return { ...f, components: { ...f.components, [groupId]: g } };
    });
  };

  const country = PAESI.find(p => p.code === form.countryCode) || PAESI[0];
  const totalSteps = STEP_META.length;
  const isLast = step === totalSteps - 1;

  const handleSave = () => {
    const machine = {
      id: form.id,
      job: form.job,
      jobBody: form.jobBody || form.job,
      jobContainer: form.jobContainer || form.job,
      model: form.modello,
      year: form.anno,
      customer: form.customer,
      country: country.label,
      countryCode: form.countryCode,
      site: form.site,
      status: 'production',
      progress: 0,
      deliveryDate: form.deliveryDate,
      productionStart: form.productionStart,
      pressureSettings: form.pressure,
      plate: { weight: form.weight, power: form.power, voltage: form.voltage },
      components: Object.fromEntries(
        Object.entries(form.components).map(([k, v]) => [k, {
          brand: v.brand || '—',
          items: v.items.map(i => i || '—'),
          ...(v.extra ? { extra: v.extra } : {}),
        }])
      ),
    };
    // Add to global data
    window.APP_DATA.MACHINES.unshift(machine);
    window.APP_DATA.DIARY[machine.id] = [{
      date: new Date().toISOString().slice(0, 10),
      phase: 'production',
      title: 'Apertura fascicolo tecnico',
      actor: 'Sistema',
      note: `Fascicolo creato. Job ${machine.job} — ${machine.customer || 'cliente da definire'}.`,
    }];
    setSaved(true);
    if (onSave) onSave(machine);
  };

  if (saved) return <SavedScreen form={form} country={country} onClose={onClose}/>;

  return (
    <div className="nm-shell">
      <div className="nm-header">
        <div className="nm-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M7 9l5-3 5 3v6l-5 3-5-3z"/>
            <path d="M12 6v12"/>
          </svg>
          <span>Fascicolo Tecnico</span>
        </div>
        <div className="nm-title">Nuova macchina</div>
        <button className="icon-btn nm-close" onClick={onClose}><FtIcon name="x" size={16}/></button>
      </div>

      <div className="nm-body">
        {/* Stepper sidebar */}
        <aside className="nm-stepper">
          {STEP_META.map((s, i) => (
            <button
              key={s.id}
              className={'nm-step' + (i === step ? ' active' : '') + (i < step ? ' done' : '')}
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
            >
              <div className="nm-step-num">
                {i < step ? <FtIcon name="check" size={12}/> : <span>{i + 1}</span>}
              </div>
              <div className="nm-step-info">
                <div className="nm-step-label">{s.label}</div>
                <div className="nm-step-desc">{s.desc}</div>
              </div>
            </button>
          ))}
          <div className="nm-step-prog">
            <div className="nm-step-prog-bar" style={{ height: `${(step / (totalSteps - 1)) * 100}%` }}></div>
          </div>
        </aside>

        {/* Step content */}
        <div className="nm-content">
          {step === 0 && <Step1 form={form} set={set}/>}
          {step === 1 && <Step2 form={form} set={set}/>}
          {step === 2 && <Step3 form={form} set={set}/>}
          {step === 3 && <Step4 form={form} setComp={setComp} openGroup={openGroup} setOpenGroup={setOpenGroup}/>}
          {step === 4 && <Step5 form={form} country={country}/>}
        </div>
      </div>

      <div className="nm-footer">
        <div className="nm-footer-info muted small">
          {step < 3 ? `Step ${step + 1} di ${totalSteps}` : step === 3 ? 'Inserisci le matricole disponibili — gli slot vuoti si possono completare in produzione' : 'Verifica i dati prima di confermare'}
        </div>
        <div className="nm-footer-actions">
          {step > 0 && <button className="btn-ghost" onClick={() => setStep(s => s - 1)}><FtIcon name="arrow-left" size={14}/> Indietro</button>}
          {!isLast
            ? <button className="btn-primary" onClick={() => setStep(s => s + 1)}>Avanti <FtIcon name="arrow-right" size={14}/></button>
            : <button className="btn-primary nm-confirm" onClick={handleSave}><FtIcon name="check" size={14}/> Crea fascicolo</button>
          }
        </div>
      </div>
    </div>
  );
};

// ── Step 1: Identificazione ──────────────────────────────────────────────────
const Step1 = ({ form, set }) => (
  <div className="nm-step-content">
    <div className="nm-step-header">
      <h2>Identificazione macchina</h2>
      <p className="muted">Numeri di job, modello e anno di fabbricazione. L'ID fascicolo viene generato automaticamente.</p>
    </div>

    <div className="nm-field-group">
      <div className="nm-field-row col2">
        <div className="form-row">
          <label>ID Fascicolo <span className="nm-auto">auto</span></label>
          <input className="input mono" value={form.id} readOnly/>
        </div>
        <div className="form-row">
          <label>Anno</label>
          <input className="input mono" type="number" value={form.anno} onChange={e => set('anno', +e.target.value)} min="2000" max="2099"/>
        </div>
      </div>

      <div className="nm-field-row col3">
        <div className="form-row">
          <label>Job Number (1xxxxx) <span className="nm-req">*</span></label>
          <input className="input mono" value={form.job} onChange={e => set('job', e.target.value)} placeholder="1260200"/>
        </div>
        <div className="form-row">
          <label>Job Body (5xxxxx)</label>
          <input className="input mono" value={form.jobBody} onChange={e => set('jobBody', e.target.value)} placeholder="5260200"/>
        </div>
        <div className="form-row">
          <label>Job Container (5xxxxx)</label>
          <input className="input mono" value={form.jobContainer} onChange={e => set('jobContainer', e.target.value)} placeholder="5260201"/>
        </div>
      </div>

      <div className="form-row">
        <label>Modello <span className="nm-req">*</span></label>
        <select className="input" value={form.modello} onChange={e => set('modello', e.target.value)}>
          {MODELLI.map(m => <option key={m}>{m}</option>)}
        </select>
      </div>

      <div className="nm-info-box">
        <FtIcon name="doc" size={15}/>
        <p>L'ID <span className="mono">{form.id}</span> è il codice univoco del fascicolo. Viene stampato sull'etichetta QR della macchina e non può essere modificato dopo la creazione.</p>
      </div>
    </div>
  </div>
);

// ── Step 2: Cliente ──────────────────────────────────────────────────────────
const Step2 = ({ form, set }) => {
  const { CountryDot } = window.UI;
  return (
    <div className="nm-step-content">
      <div className="nm-step-header">
        <h2>Cliente e destinazione</h2>
        <p className="muted">Chi riceve la macchina, dove viene installata e le date di consegna.</p>
      </div>

      <div className="nm-field-group">
        <div className="nm-field-row col2">
          <div className="form-row">
            <label>Cliente <span className="nm-req">*</span></label>
            <input className="input" value={form.customer} onChange={e => set('customer', e.target.value)} placeholder="es. NORD METAL RECYCLING GmbH"/>
          </div>
          <div className="form-row">
            <label>Paese <span className="nm-req">*</span></label>
            <select className="input" value={form.countryCode} onChange={e => set('countryCode', e.target.value)}>
              {PAESI.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <label>Sito di installazione</label>
          <input className="input" value={form.site} onChange={e => set('site', e.target.value)} placeholder="es. Hannover, DE"/>
        </div>

        <div className="nm-field-row col2">
          <div className="form-row">
            <label>Inizio produzione</label>
            <input className="input" type="date" value={form.productionStart} onChange={e => set('productionStart', e.target.value)}/>
          </div>
          <div className="form-row">
            <label>Data consegna prevista</label>
            <input className="input" type="date" value={form.deliveryDate} onChange={e => set('deliveryDate', e.target.value)}/>
          </div>
        </div>

        {form.customer && (
          <div className="nm-preview-card">
            <CountryDot code={form.countryCode}/>
            <div>
              <div className="nm-preview-name">{form.customer}</div>
              <div className="muted small">{form.site || 'Sito non specificato'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Step 3: Targa tecnica ────────────────────────────────────────────────────
const Step3 = ({ form, set }) => (
  <div className="nm-step-content">
    <div className="nm-step-header">
      <h2>Targa tecnica</h2>
      <p className="muted">Dati che compaiono sulla targa CE e nel fascicolo di sicurezza.</p>
    </div>

    <div className="nm-field-group">
      <div className="nm-field-row col2">
        <div className="form-row">
          <label>Peso totale</label>
          <div className="input-with-unit">
            <input className="input" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="38 500"/>
            <span className="input-unit">kg</span>
          </div>
        </div>
        <div className="form-row">
          <label>Potenza nominale</label>
          <div className="input-with-unit">
            <input className="input" value={form.power} onChange={e => set('power', e.target.value)} placeholder="450"/>
            <span className="input-unit">kW</span>
          </div>
        </div>
      </div>

      <div className="nm-field-row col2">
        <div className="form-row">
          <label>Tensione / Frequenza</label>
          <select className="input" value={form.voltage} onChange={e => set('voltage', e.target.value)}>
            <option>400V / 50Hz</option>
            <option>480V / 60Hz</option>
            <option>690V / 50Hz</option>
            <option>380V / 50Hz</option>
          </select>
        </div>
        <div className="form-row">
          <label>Settaggi pressione</label>
          <input className="input mono" value={form.pressure} onChange={e => set('pressure', e.target.value)} placeholder="255 bar + 3/4 giro (320 bar)"/>
        </div>
      </div>

      <div className="nm-targa-preview">
        <div className="targa-box">
          <div className="targa-top">TARGA MACCHINA</div>
          <div className="targa-row"><span>Modello</span><span>{form.modello || '—'}</span></div>
          <div className="targa-row"><span>N° Fascicolo</span><span className="mono">{form.id}</span></div>
          <div className="targa-row"><span>Anno</span><span>{form.anno}</span></div>
          <div className="targa-row"><span>Peso</span><span>{form.weight ? form.weight + ' kg' : '—'}</span></div>
          <div className="targa-row"><span>Potenza</span><span>{form.power ? form.power + ' kW' : '—'}</span></div>
          <div className="targa-row"><span>Tensione</span><span>{form.voltage || '—'}</span></div>
          <div className="targa-row"><span>Pressione</span><span className="mono">{form.pressure || '—'}</span></div>
          <div className="targa-ce">CE</div>
        </div>
      </div>
    </div>
  </div>
);

// ── Step 4: Componenti ───────────────────────────────────────────────────────
const Step4 = ({ form, setComp, openGroup, setOpenGroup }) => {
  const filledCount = NM_GROUPS.reduce((acc, g) => {
    const c = form.components[g.id];
    return acc + (c?.items.filter(i => i && i.trim()).length || 0);
  }, 0);
  const totalSlots = NM_GROUPS.reduce((acc, g) => acc + g.slots.length, 0);

  return (
    <div className="nm-step-content nm-step-content-wide">
      <div className="nm-step-header">
        <h2>Componenti e matricole</h2>
        <p className="muted">Inserisci brand e serial number per ogni componente. Gli slot vuoti si possono completare in produzione.</p>
      </div>

      <div className="nm-cmp-progress">
        <div className="nm-cmp-prog-bar">
          <div style={{ width: `${(filledCount / totalSlots) * 100}%` }}></div>
        </div>
        <span className="mono small muted">{filledCount} / {totalSlots} matricole</span>
      </div>

      <div className="nm-cmp-list">
        {NM_GROUPS.map(group => {
          const c = form.components[group.id];
          const filled = c?.items.filter(i => i && i.trim()).length || 0;
          const isOpen = openGroup === group.id;
          return (
            <div key={group.id} className={'nm-cmp-row' + (isOpen ? ' open' : '')}>
              <button className="cmp-row-head" onClick={() => setOpenGroup(isOpen ? null : group.id)}>
                <span className="cmp-icon"><FtIcon name={group.icon} size={20}/></span>
                <div className="cmp-name">
                  <div className="cmp-label">{group.label}</div>
                  <div className="cmp-en mono muted">{group.en}</div>
                </div>
                <div className="cmp-brand">
                  {c?.brand ? <span>{c.brand}</span> : <span className="muted">—</span>}
                </div>
                <div className="cmp-count">
                  <span className={'cmp-count-pill' + (filled === group.slots.length ? ' full' : filled > 0 ? ' partial' : ' empty')}>
                    {filled} / {group.slots.length}
                  </span>
                </div>
                <FtIcon name={isOpen ? 'chev-down' : 'chev-right'} size={16}/>
              </button>

              {isOpen && (
                <div className="nm-cmp-body">
                  <div className="nm-cmp-brand-row">
                    <div className="form-row">
                      <label>Fornitore / Brand</label>
                      <input className="input" placeholder="es. DINAMIC OIL" value={c?.brand || ''} onChange={e => setComp(group.id, 'brand', e.target.value)}/>
                    </div>
                  </div>
                  <div className="nm-slots">
                    {group.slots.map((slot, i) => (
                      <div key={i} className="form-row nm-slot">
                        <label>{slot}</label>
                        <input className="input mono" placeholder="Matricola / S.N." value={c?.items[i] || ''} onChange={e => setComp(group.id, 'item', e.target.value, i)}/>
                      </div>
                    ))}
                    {group.extra && c?.extra && Object.entries(group.extra).map(([k, lbl]) => (
                      <div key={k} className="form-row nm-slot">
                        <label>{lbl}</label>
                        <input className="input mono" value={c.extra[k] || ''} onChange={e => setComp(group.id, 'extra', { [k]: e.target.value })}/>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Step 5: Riepilogo ────────────────────────────────────────────────────────
const Step5 = ({ form, country }) => {
  const { CountryDot } = window.UI;
  const filledCmps = NM_GROUPS.filter(g => form.components[g.id]?.brand || form.components[g.id]?.items.some(i => i && i.trim()));

  return (
    <div className="nm-step-content">
      <div className="nm-step-header">
        <h2>Riepilogo — pronto per la creazione</h2>
        <p className="muted">Verifica i dati prima di creare il fascicolo. Tutto sarà modificabile in seguito.</p>
      </div>

      <div className="nm-summary">
        <div className="nm-summary-card nm-summary-id">
          <div className="nm-summary-tag">FASCICOLO TECNICO</div>
          <div className="nm-summary-main">{form.id}</div>
          <div className="nm-summary-sub">{form.modello}</div>
        </div>

        <div className="nm-summary-grid">
          <section className="nm-summary-section">
            <h4>Identificazione</h4>
            <dl className="kv kv-sm">
              <div><dt>Job Number</dt><dd className="mono">{form.job || '—'}</dd></div>
              <div><dt>Job Body</dt><dd className="mono">{form.jobBody || form.job || '—'}</dd></div>
              <div><dt>Job Container</dt><dd className="mono">{form.jobContainer || form.job || '—'}</dd></div>
              <div><dt>Anno</dt><dd>{form.anno}</dd></div>
            </dl>
          </section>

          <section className="nm-summary-section">
            <h4>Cliente</h4>
            <dl className="kv kv-sm">
              <div><dt>Cliente</dt><dd>{form.customer || '—'}</dd></div>
              <div><dt>Paese</dt><dd><div style={{display:'flex',alignItems:'center',gap:6}}><CountryDot code={form.countryCode}/>{country.label}</div></dd></div>
              <div><dt>Sito</dt><dd>{form.site || '—'}</dd></div>
              <div><dt>Inizio prod.</dt><dd className="mono">{form.productionStart}</dd></div>
              <div><dt>Consegna</dt><dd className="mono">{form.deliveryDate || '—'}</dd></div>
            </dl>
          </section>

          <section className="nm-summary-section">
            <h4>Targa tecnica</h4>
            <dl className="kv kv-sm">
              <div><dt>Peso</dt><dd>{form.weight ? form.weight + ' kg' : '—'}</dd></div>
              <div><dt>Potenza</dt><dd>{form.power ? form.power + ' kW' : '—'}</dd></div>
              <div><dt>Tensione</dt><dd>{form.voltage}</dd></div>
              <div><dt>Pressione</dt><dd className="mono">{form.pressure || '—'}</dd></div>
            </dl>
          </section>

          <section className="nm-summary-section">
            <h4>Componenti censiti</h4>
            <div className="nm-summary-cmps">
              {filledCmps.length > 0 ? filledCmps.map(g => {
                const c = form.components[g.id];
                const filled = c.items.filter(i => i && i.trim()).length;
                return (
                  <div key={g.id} className="nm-summary-cmp">
                    <FtIcon name={g.icon} size={14}/>
                    <span>{g.label}</span>
                    <span className="mono muted small">{c.brand || ''}</span>
                    <span className={'cmp-count-pill' + (filled === g.slots.length ? ' full' : ' partial')} style={{fontSize:10}}>
                      {filled}/{g.slots.length}
                    </span>
                  </div>
                );
              }) : <span className="muted small">Nessun componente inserito — completare in produzione</span>}
            </div>
          </section>
        </div>

        <div className="nm-info-box nm-info-box-green">
          <FtIcon name="check" size={15}/>
          <p>Cliccando <strong>"Crea fascicolo"</strong> la macchina sarà aggiunta alla lista con stato <strong>In produzione</strong>. Un primo evento verrà registrato automaticamente nel diario.</p>
        </div>
      </div>
    </div>
  );
};

// ── Saved screen ─────────────────────────────────────────────────────────────
const SavedScreen = ({ form, country, onClose }) => {
  const { FakeQR } = window.UI;
  return (
    <div className="nm-shell">
      <div className="nm-header">
        <div className="nm-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M7 9l5-3 5 3v6l-5 3-5-3z"/>
            <path d="M12 6v12"/>
          </svg>
          <span>Fascicolo Tecnico</span>
        </div>
        <div className="nm-title">Fascicolo creato!</div>
        <div></div>
      </div>
      <div className="nm-saved">
        <div className="nm-saved-icon"><FtIcon name="check" size={32}/></div>
        <h2>Fascicolo <span className="mono">{form.id}</span> creato</h2>
        <p className="muted">{form.modello} · {form.customer} · {country.label}</p>

        <div className="nm-saved-qr">
          <FakeQR value={`https://fascicolo.zato.it/m/${form.id}`} size={160}/>
          <div className="nm-saved-qr-info">
            <div className="mono small muted">Stampa l'etichetta QR e applicala sulla macchina</div>
            <div className="mono">{form.id}</div>
            <button className="btn-ghost-sm" style={{marginTop:8}}><FtIcon name="download" size={13}/> Scarica etichetta PDF</button>
          </div>
        </div>

        <div className="nm-saved-actions">
          <button className="btn-ghost" onClick={onClose}><FtIcon name="arrow-left" size={14}/> Torna alla lista</button>
          <button className="btn-primary" onClick={onClose}><FtIcon name="doc" size={14}/> Apri fascicolo</button>
        </div>
      </div>
    </div>
  );
};

window.NewMachineView = NewMachineView;
