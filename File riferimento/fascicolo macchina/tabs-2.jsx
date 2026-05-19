// Detail tabs: Foto, Collaudo, Diario, QR
const T2_PhaseChip = window.UI.PhaseChip;
const T2_PhotoPlaceholder = window.UI.PhotoPlaceholder;
const T2_FakeQR = window.UI.FakeQR;

const TabFoto = ({ machine }) => {
  const [filter, setFilter] = React.useState('all');
  const phases = [
    { id: 'all', label: 'Tutte', n: 24 },
    { id: 'frame', label: 'Telaio', n: 6 },
    { id: 'hyd', label: 'Idraulica', n: 7 },
    { id: 'elec', label: 'Quadro elettrico', n: 4 },
    { id: 'final', label: 'Finiture', n: 4 },
    { id: 'check', label: 'Checklist obbligatorie', n: 3 },
  ];
  const photos = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    cat: ['frame','frame','hyd','hyd','hyd','elec','frame','hyd','hyd','elec','frame','hyd','hyd','elec','frame','hyd','final','final','final','final','check','check','check','elec'][i],
    label: ['Telaio - vista frontale','Telaio - saldature','Pompa idraulica P1','Pompa idraulica P2','Riduttore #1','Quadro - cablaggio','Telaio - dettaglio','Centralina','Tubazioni alta pressione','Quadro - chiusura','Container vista esterna','Filtri olio','Manometri','HMI fronte','Telaio - verniciatura','Pompa boost #3 (sostituita)','Vernice top coat','Targhe CE','Etichetta matricola','Vista d\'insieme','Checklist coppia serraggio','Checklist isolamento','Checklist pressione','Cablaggio finale'][i],
    date: ['2025-11-08','2025-11-12','2025-12-03','2025-12-03','2025-11-26','2026-01-14','2025-11-15','2025-12-10','2025-12-15','2026-01-16','2026-02-20','2025-12-22','2026-02-01','2026-02-09','2026-02-25','2026-04-05','2026-03-10','2026-03-12','2026-03-12','2026-03-15','2025-12-04','2026-01-17','2026-04-30','2026-01-20'][i],
    actor: ['L. Bianchi','L. Bianchi','A. Verdi','A. Verdi','A. Verdi','P. Costa','L. Bianchi','A. Verdi','A. Verdi','P. Costa','L. Bianchi','A. Verdi','A. Verdi','G. Marini','L. Bianchi','A. Verdi','L. Bianchi','L. Bianchi','L. Bianchi','L. Bianchi','A. Verdi','P. Costa','F. Greco','P. Costa'][i],
    flag: i === 15 ? 'Sostituzione' : (i >= 20 && i <= 22 ? 'Obbligatoria' : null),
  }));
  const filtered = filter === 'all' ? photos : photos.filter(p => p.cat === filter);
  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="phase-filters">
          {phases.map(p => (
            <button key={p.id} className={'chip-btn' + (filter === p.id ? ' active' : '')} onClick={() => setFilter(p.id)}>
              {p.label} <span className="chip-n">{p.n}</span>
            </button>
          ))}
        </div>
        <div className="cmp-actions">
          <button className="btn-ghost-sm"><FtIcon name="camera" size={14}/> Carica foto</button>
        </div>
      </div>
      <div className="photo-grid">
        {filtered.map(p => (
          <figure key={p.id} className="photo-card">
            <T2_PhotoPlaceholder seed={p.id * 11 + 5} label={`${p.id+1}`} badge={p.flag}/>
            <figcaption>
              <div className="photo-title">{p.label}</div>
              <div className="photo-meta mono muted">{p.date} · {p.actor}</div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
};

const TabCollaudo = ({ machine, onSign }) => {
  const checks = [
    { cat: 'Sicurezza', items: [
      { label: 'Verifica continuità di terra', done: true, value: '0.08 Ω', tol: '< 0.1 Ω' },
      { label: 'Test funi/fermi di emergenza', done: true, value: 'OK', tol: 'Conforme' },
      { label: 'Verifica protezioni meccaniche', done: true, value: 'OK', tol: 'Conforme' },
    ]},
    { cat: 'Idraulica', items: [
      { label: 'Pressione massima circuito principale', done: true, value: '320 bar', tol: '320 ± 10 bar' },
      { label: 'Pressione boost', done: true, value: '28 bar', tol: '25 — 30 bar' },
      { label: 'Temperatura olio dopo 8h', done: true, value: '62 °C', tol: '< 75 °C' },
      { label: 'Tenuta tubazioni alta pressione', done: true, value: 'OK', tol: 'No perdite' },
    ]},
    { cat: 'Elettrica', items: [
      { label: 'Isolamento avvolgimenti', done: true, value: '> 200 MΩ', tol: '> 100 MΩ' },
      { label: 'Squilibrio fasi', done: true, value: '0.8 %', tol: '< 2 %' },
      { label: 'Funzionamento radiocomando IMET', done: true, value: 'OK', tol: 'Tutti i comandi' },
    ]},
    { cat: 'Funzionale', items: [
      { label: 'Sequenza avvio', done: true, value: 'OK', tol: 'Conforme' },
      { label: 'Test 8h continuative a carico', done: machine.status === 'testing' || machine.progress >= 70, value: machine.progress >= 70 ? 'OK' : '—', tol: 'Conforme' },
      { label: 'Riaffilatura lame post-test', done: machine.progress >= 70, value: machine.progress >= 70 ? 'OK' : '—', tol: 'Conforme' },
    ]},
  ];
  const total = checks.reduce((a, c) => a + c.items.length, 0);
  const done = checks.reduce((a, c) => a + c.items.filter(i => i.done).length, 0);
  return (
    <div className="tab-content">
      <div className="grid-collaudo">
        <section className="card collaudo-main">
          <header className="card-header">
            <div>
              <h3>Verbale di collaudo · {machine.id}</h3>
              <div className="muted small">CL-{machine.year}-{String(machine.id.slice(-3)).padStart(4,'0')}</div>
            </div>
            <div className="collaudo-progress">
              <div className="progress-ring" style={{ '--p': (done/total*100) }}>
                <span className="progress-text mono">{done}/{total}</span>
              </div>
            </div>
          </header>
          {checks.map(group => (
            <div key={group.cat} className="check-group">
              <h4 className="check-group-h">{group.cat}</h4>
              <ul className="check-list">
                {group.items.map((it, i) => (
                  <li key={i} className={'check-item' + (it.done ? ' done' : '')}>
                    <span className={'check-box' + (it.done ? ' on' : '')}>
                      {it.done && <FtIcon name="check" size={12}/>}
                    </span>
                    <div className="check-label">{it.label}</div>
                    <div className="check-value mono">{it.value}</div>
                    <div className="check-tol mono muted">{it.tol}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Firme</h3>
          </header>
          <SignatureBlock role="Montaggio" name="A. Verdi" date="2026-02-09" signed={true}/>
          <SignatureBlock role="Collaudo" name="F. Greco" date={machine.progress >= 70 ? '2026-04-30' : null} signed={machine.progress >= 70} onSign={onSign}/>
          <SignatureBlock role="Capo officina" name="M. Rossi" date={machine.progress >= 70 ? '2026-04-30' : null} signed={machine.progress >= 70} onSign={onSign}/>

          <div className="card-divider"></div>
          <h4 className="check-group-h">Documenti del verbale</h4>
          <ul className="doc-list">
            <li><FtIcon name="doc" size={16}/> <span>Verbale collaudo CL-{machine.year}-091.pdf</span><span className="muted mono">920 KB</span></li>
            <li><FtIcon name="doc" size={16}/> <span>Report prove prestazionali.pdf</span><span className="muted mono">1.4 MB</span></li>
            <li><FtIcon name="doc" size={16}/> <span>Tracciato dati 8h.csv</span><span className="muted mono">3.2 MB</span></li>
          </ul>
        </section>
      </div>
    </div>
  );
};

const SignatureBlock = ({ role, name, date, signed, onSign }) => {
  return (
    <div className={'sig-block' + (signed ? ' signed' : '')}>
      <div className="sig-block-meta">
        <div className="sig-role mono muted">{role}</div>
        <div className="sig-name">{name}</div>
        <div className="sig-date mono muted">{date || 'In attesa di firma'}</div>
      </div>
      <div className="sig-block-area">
        {signed ? (
          <svg viewBox="0 0 160 50" className="sig-rendered">
            <path d="M5 35 q10 -20 25 -10 t30 5 q15 0 20 -15 q5 15 25 5 t30 0 q10 5 20 -5" stroke="#0f172a" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
            <path d="M50 30 l8 -8 l4 4 z" stroke="#0f172a" strokeWidth="1.2" fill="#0f172a"/>
          </svg>
        ) : (
          <button className="btn-primary-sm sig-btn" onClick={onSign}><FtIcon name="sign" size={14}/> Firma</button>
        )}
      </div>
    </div>
  );
};

const TabDiario = ({ machine, onIntervention }) => {
  const events = window.APP_DATA.DIARY[machine.id] || [];
  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="cmp-summary">
          <span className="muted">Eventi registrati:</span> <strong>{events.length}</strong>
          <span className="dot-sep">·</span>
          <span className="muted">Primo:</span> <strong className="mono">{events[0]?.date || '—'}</strong>
          <span className="dot-sep">·</span>
          <span className="muted">Ultimo:</span> <strong className="mono">{events[events.length-1]?.date || '—'}</strong>
        </div>
        <div className="cmp-actions">
          <button className="btn-primary-sm" onClick={onIntervention}><FtIcon name="plus" size={14}/> Nuovo intervento</button>
        </div>
      </div>

      <ol className="timeline">
        {events.map((e, i) => (
          <li key={i} className="tl-item">
            <div className="tl-rail">
              <span className="tl-dot" style={{ background: window.APP_DATA.PHASE_META[e.phase]?.color || '#71717a' }}></span>
              {i < events.length - 1 && <span className="tl-line"></span>}
            </div>
            <div className="tl-card">
              <header className="tl-head">
                <T2_PhaseChip phase={e.phase}/>
                <span className="tl-date mono">{e.date}</span>
                {e.signed && <span className="tl-signed"><FtIcon name="check" size={12}/> firmato</span>}
              </header>
              <h4 className="tl-title">{e.title}</h4>
              {e.note && <p className="tl-note">{e.note}</p>}
              <footer className="tl-foot">
                <span className="muted small">{e.actor}</span>
                {e.sn && <span className="tl-sn mono">S/N: {e.sn}</span>}
              </footer>
            </div>
          </li>
        ))}
        {events.length === 0 && <li className="muted">Nessun evento registrato.</li>}
      </ol>
    </div>
  );
};

const TabQR = ({ machine }) => {
  const url = `https://fascicolo.zato.it/m/${machine.id}`;
  return (
    <div className="tab-content">
      <div className="grid-qr">
        <section className="card qr-card">
          <header className="card-header">
            <h3>Etichetta macchina</h3>
            <button className="btn-ghost-sm"><FtIcon name="download" size={14}/> Scarica PDF</button>
          </header>
          <div className="label-preview">
            <div className="label-paper">
              <div className="label-top">
                <div>
                  <div className="label-brand mono">FASCICOLO TECNICO</div>
                  <div className="label-id">{machine.id}</div>
                </div>
                <T2_FakeQR value={url} size={140}/>
              </div>
              <dl className="label-kv">
                <div><dt>Modello</dt><dd>{machine.model}</dd></div>
                <div><dt>Job</dt><dd className="mono">{machine.job}</dd></div>
                <div><dt>Anno</dt><dd>{machine.year}</dd></div>
                <div><dt>Cliente</dt><dd>{machine.customer}</dd></div>
                <div><dt>Sito</dt><dd>{machine.site}</dd></div>
                <div><dt>Pressione</dt><dd className="mono">{machine.pressureSettings}</dd></div>
              </dl>
              <div className="label-foot mono">Scansiona per accedere al fascicolo · {url}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Pagina pubblica</h3>
          </header>
          <p className="muted small">Ogni macchina ha una pagina scansionabile. Visibilità configurabile per ruolo: cliente, manutentore, operatore.</p>
          <div className="qr-toggles">
            <label className="row-toggle"><input type="checkbox" defaultChecked/> Mostra anagrafica e modello</label>
            <label className="row-toggle"><input type="checkbox" defaultChecked/> Mostra storico interventi</label>
            <label className="row-toggle"><input type="checkbox" defaultChecked/> Mostra manuali e schemi</label>
            <label className="row-toggle"><input type="checkbox"/> Mostra distinta componenti completa</label>
            <label className="row-toggle"><input type="checkbox"/> Permetti apertura ticket assistenza dal QR</label>
          </div>
          <div className="card-divider"></div>
          <h4 className="check-group-h">Tracking scansioni (ultimi 30 giorni)</h4>
          <ul className="scan-list">
            <li><span className="mono">2026-04-30 11:24</span><span>D. Ferrari</span><span className="muted">Reykjavík, IS</span></li>
            <li><span className="mono">2026-04-22 09:08</span><span>—</span><span className="muted">Anonimo</span></li>
            <li><span className="mono">2026-03-15 15:47</span><span>F. Greco</span><span className="muted">Officina ZATO</span></li>
          </ul>
        </section>
      </div>
    </div>
  );
};

window.TabFoto = TabFoto;
window.TabCollaudo = TabCollaudo;
window.TabDiario = TabDiario;
window.TabQR = TabQR;
