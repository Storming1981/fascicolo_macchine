// Machine detail view: header + tab nav + tab content
const D_CountryDot = window.UI.CountryDot;
const D_StatusBadge = window.UI.StatusBadge;

const MachineDetailView = ({ machine, tab, goTab, onIntervention, onSign, extraEvents = [], signedRoles = {} }) => {
  const tabs = [
    { id: 'anagrafica', label: 'Anagrafica', icon: 'doc' },
    { id: 'componenti', label: 'Componenti & Matricole', icon: 'gear' },
    { id: 'foto', label: 'Foto produzione', icon: 'image' },
    { id: 'collaudo', label: 'Collaudo & Firme', icon: 'sign' },
    { id: 'diario', label: 'Diario macchina', icon: 'clock' },
    { id: 'qr', label: 'QR & Etichetta', icon: 'qr' },
  ];
  const meta = window.APP_DATA.STATUS_META[machine.status];

  // Inject extra events into diary clone
  const machineWithDiary = { ...machine, diaryExtras: extraEvents };

  return (
    <div className="view detail-view">
      <header className="detail-header">
        <div className="detail-id-block">
          <div className="mono muted small">FASCICOLO TECNICO</div>
          <h1 className="detail-id mono">{machine.id}</h1>
          <div className="detail-meta">
            <span>{machine.model}</span>
            <span className="dot-sep">·</span>
            <span>Job <span className="mono">{machine.job}</span></span>
            <span className="dot-sep">·</span>
            <D_CountryDot code={machine.countryCode}/>
            <span>{machine.customer} — {machine.country}</span>
          </div>
        </div>
        <div className="detail-status-block">
          <D_StatusBadge status={machine.status}/>
          <div className="detail-progress">
            <span className="mono small muted">Avanzamento {machine.progress}%</span>
            <div className="detail-progress-bar"><span style={{ width: machine.progress + '%', background: meta.color }}></span></div>
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn-ghost"><FtIcon name="download" size={14}/> Fascicolo PDF</button>
          <button className="btn-primary" onClick={onIntervention}><FtIcon name="plus" size={14}/> Nuovo intervento</button>
        </div>
      </header>

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => goTab(t.id)}>
            <FtIcon name={t.icon} size={14}/>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'anagrafica' && <TabAnagrafica machine={machine}/>}
      {tab === 'componenti' && <TabComponenti machine={machine} onIntervention={onIntervention}/>}
      {tab === 'foto' && <TabFoto machine={machine}/>}
      {tab === 'collaudo' && <TabCollaudo machine={machine} onSign={onSign}/>}
      {tab === 'diario' && <TabDiarioWrapper machine={machine} extra={extraEvents} onIntervention={onIntervention}/>}
      {tab === 'qr' && <TabQR machine={machine}/>}
    </div>
  );
};

// Wrapper that merges base diary with newly added events
const TabDiarioWrapper = ({ machine, extra, onIntervention }) => {
  const base = window.APP_DATA.DIARY[machine.id] || [];
  const merged = [...base, ...extra].sort((a, b) => a.date.localeCompare(b.date));
  // Temporarily override the diary for this machine
  const origDiary = window.APP_DATA.DIARY[machine.id];
  window.APP_DATA.DIARY[machine.id] = merged;
  React.useEffect(() => () => { window.APP_DATA.DIARY[machine.id] = origDiary; }, []);
  return <TabDiario machine={machine} onIntervention={onIntervention}/>;
};

window.MachineDetailView = MachineDetailView;
