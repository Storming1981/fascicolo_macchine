// Main App: shell, sidebar, dashboard, machines list, detail
const A_MACHINES = window.APP_DATA.MACHINES;
const A_DIARY = window.APP_DATA.DIARY;
const A_STATUS_META = window.APP_DATA.STATUS_META;
const A_PHASE_META = window.APP_DATA.PHASE_META;
const A_StatusBadge = window.UI.StatusBadge;
const A_PhaseChip = window.UI.PhaseChip;
const A_CountryDot = window.UI.CountryDot;

const TWEAKS_DEFAULT = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "theme": "light",
  "accent": "#0a84ff"
}/*EDITMODE-END*/;

const App = () => {
  const [tw, setTweak] = useTweaks(TWEAKS_DEFAULT);

  const [route, setRoute] = React.useState({ view: 'dashboard' });
  const [interventionFor, setInterventionFor] = React.useState(null);
  const [signFor, setSignFor] = React.useState(null);
  const [extraEvents, setExtraEvents] = React.useState({}); // machineId -> [events]
  const [signedRoles, setSignedRoles] = React.useState({}); // role+id -> true

  React.useEffect(() => {
    document.documentElement.dataset.theme = tw.theme;
    document.documentElement.dataset.density = tw.density;
    document.documentElement.style.setProperty('--accent', tw.accent);
  }, [tw.theme, tw.density, tw.accent]);

  const goMachine = (id) => setRoute({ view: 'machine', id, tab: 'anagrafica' });
  const goNewMachine = () => setRoute({ view: 'new-machine' });
  const goTab = (tab) => setRoute(r => ({ ...r, tab }));

  const machineWithExtra = (m) => {
    const extra = extraEvents[m.id] || [];
    return { ...m, _extraEvents: extra };
  };

  const addEvent = (machineId, ev) => {
    setExtraEvents(s => ({ ...s, [machineId]: [...(s[machineId] || []), ev] }));
  };

  return (
    <div className="app">
      <Sidebar route={route} setRoute={setRoute}/>
      <main className="main">
        <Topbar route={route} setRoute={setRoute}/>
        {route.view === 'dashboard' && <DashboardView goMachine={goMachine} goNewMachine={goNewMachine}/>}
        {route.view === 'machines' && <MachinesView goMachine={goMachine} goNewMachine={goNewMachine}/>}
        {route.view === 'people' && <PeopleView/>}
        {route.view === 'new-machine' && (
          <NewMachineView
            onClose={() => setRoute({ view: 'machines' })}
            onSave={(m) => setRoute({ view: 'machine', id: m.id, tab: 'anagrafica' })}
          />
        )}
        {route.view === 'machine' && (() => {
          const m = A_MACHINES.find(x => x.id === route.id);
          if (!m) return <div className="empty">Macchina non trovata</div>;
          return <MachineDetailView
            machine={m}
            tab={route.tab}
            goTab={goTab}
            onIntervention={() => setInterventionFor(m)}
            onSign={() => setSignFor({ machineId: m.id, role: 'Collaudatore' })}
            extraEvents={extraEvents[m.id] || []}
            signedRoles={signedRoles}
          />;
        })()}
      </main>

      {interventionFor && (
        <InterventionModal
          machine={interventionFor}
          onClose={() => setInterventionFor(null)}
          onSave={(ev) => addEvent(interventionFor.id, ev)}
        />
      )}
      {signFor && (
        <SignModal
          role={signFor.role}
          onClose={() => setSignFor(null)}
          onConfirm={() => { setSignedRoles(s => ({ ...s, [signFor.machineId+signFor.role]: true })); setSignFor(null); }}
        />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Aspetto">
          <TweakRadio label="Tema" value={tw.theme} options={['light','dark']} optionLabels={['Chiaro','Scuro']} onChange={v => setTweak('theme', v)}/>
          <TweakRadio label="Densità" value={tw.density} options={['compact','comfortable']} optionLabels={['Compatta','Comoda']} onChange={v => setTweak('density', v)}/>
          <TweakColor label="Accento" value={tw.accent} options={['#0a84ff','#7c3aed','#10b981','#ea580c']} onChange={v => setTweak('accent', v)}/>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

const Sidebar = ({ route, setRoute }) => {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home' },
    { id: 'machines', label: 'Macchine', icon: 'machines', badge: A_MACHINES.length },
    { id: 'people', label: 'Persone & Firme', icon: 'people' },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M7 9l5 -3 l5 3 v6 l-5 3 l-5 -3z"/>
            <path d="M12 6v12"/>
          </svg>
        </div>
        <div>
          <div className="brand-name">Fascicolo</div>
          <div className="brand-sub mono muted">tecnico macchina</div>
        </div>
      </div>
      <nav className="nav">
        {items.map(it => (
          <button
            key={it.id}
            className={'nav-item' + (route.view === it.id ? ' active' : '')}
            onClick={() => setRoute({ view: it.id })}
          >
            <FtIcon name={it.icon} size={18}/>
            <span>{it.label}</span>
            {it.badge != null && <span className="nav-badge">{it.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="user">
          <div className="user-avatar">MR</div>
          <div>
            <div className="user-name">Mario Rossi</div>
            <div className="user-role muted small">Capo officina · ZATO</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

const Topbar = ({ route, setRoute }) => {
  const crumbs = [];
  if (route.view === 'dashboard') crumbs.push({ label: 'Dashboard' });
  else if (route.view === 'machines') crumbs.push({ label: 'Macchine' });
  else if (route.view === 'people') crumbs.push({ label: 'Persone & Firme' });
  else if (route.view === 'new-machine') {
    crumbs.push({ label: 'Macchine', click: () => setRoute({ view: 'machines' }) });
    crumbs.push({ label: 'Nuova macchina' });
  } else if (route.view === 'machine') {
    crumbs.push({ label: 'Macchine', click: () => setRoute({ view: 'machines' }) });
    const m = A_MACHINES.find(x => x.id === route.id);
    if (m) crumbs.push({ label: m.id });
  }
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <FtIcon name="chev-right" size={14} color="var(--muted)"/>}
            {c.click ? <button className="crumb-link" onClick={c.click}>{c.label}</button> : <span className="crumb">{c.label}</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-actions">
        <div className="search">
          <FtIcon name="search" size={14} color="var(--muted)"/>
          <input placeholder="Cerca per matricola, job, cliente…"/>
          <kbd>⌘K</kbd>
        </div>
        <button className="icon-btn topbar-icon"><FtIcon name="bell" size={16}/></button>
      </div>
    </header>
  );
};

const DashboardView = ({ goMachine, goNewMachine }) => {
  const stats = {
    production: A_MACHINES.filter(m => m.status === 'production').length,
    testing: A_MACHINES.filter(m => m.status === 'testing').length,
    shipped: A_MACHINES.filter(m => m.status === 'shipped').length,
    field: A_MACHINES.filter(m => ['installed','maintenance'].includes(m.status)).length,
  };
  const recentEvents = A_MACHINES.flatMap(m => (A_DIARY[m.id] || []).map(e => ({ ...e, machine: m })))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Stato della flotta produttiva e in esercizio</p>
        </div>
        <div>
          <button className="btn-primary" onClick={goNewMachine}><FtIcon name="plus" size={14}/> Nuova macchina</button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="In produzione" value={stats.production} icon="machines" tone="#0a84ff"/>
        <StatCard label="In collaudo" value={stats.testing} icon="check" tone="#f59e0b"/>
        <StatCard label="Spedite / in transito" value={stats.shipped} icon="truck" tone="#8b5cf6"/>
        <StatCard label="In esercizio (campo)" value={stats.field} icon="flag" tone="#10b981"/>
      </div>

      <div className="grid-two">
        <section className="card">
          <header className="card-header">
            <h3>Pipeline produzione</h3>
            <button className="btn-ghost-sm" onClick={() => null}>Vedi tutte</button>
          </header>
          <div className="pipeline">
            {['production','testing','shipped','installed','maintenance','scrapped'].map(s => {
              const meta = A_STATUS_META[s];
              const items = A_MACHINES.filter(m => m.status === s);
              return (
                <div key={s} className="pipe-col">
                  <header className="pipe-col-h">
                    <span className="badge-dot" style={{ background: meta.dot }}></span>
                    <span>{meta.label}</span>
                    <span className="muted mono">{items.length}</span>
                  </header>
                  <div className="pipe-cards">
                    {items.map(m => (
                      <button key={m.id} className="pipe-card" onClick={() => goMachine(m.id)}>
                        <div className="pipe-card-id mono">{m.id}</div>
                        <div className="pipe-card-customer">{m.customer}</div>
                        <div className="pipe-card-meta">
                          <A_CountryDot code={m.countryCode}/>
                          <span className="muted small">{m.country}</span>
                        </div>
                        <div className="pipe-progress"><span style={{ width: m.progress + '%', background: meta.color }}></span></div>
                      </button>
                    ))}
                    {items.length === 0 && <div className="muted small empty-pipe">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Attività recenti</h3>
          </header>
          <ul className="activity-list">
            {recentEvents.map((e, i) => (
              <li key={i} className="activity-row" onClick={() => goMachine(e.machine.id)}>
                <div className="activity-rail" style={{ background: A_PHASE_META[e.phase]?.color }}></div>
                <div className="activity-body">
                  <div className="activity-title">{e.title}</div>
                  <div className="activity-meta muted small">
                    <span className="mono">{e.date}</span>
                    <span>·</span>
                    <span className="mono">{e.machine.id}</span>
                    <span>·</span>
                    <span>{e.actor}</span>
                  </div>
                </div>
                <A_PhaseChip phase={e.phase}/>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, tone }) => (
  <div className="stat-card">
    <div className="stat-icon" style={{ background: tone + '1a', color: tone }}>
      <FtIcon name={icon} size={18}/>
    </div>
    <div>
      <div className="stat-label muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  </div>
);

const MachinesView = ({ goMachine, goNewMachine }) => {
  const [q, setQ] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const filtered = A_MACHINES.filter(m => {
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (!q) return true;
    const hay = [m.id, m.job, m.customer, m.country, m.model].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Macchine</h1>
          <p className="muted">{A_MACHINES.length} fascicoli · dalla genesi alla rottamazione</p>
        </div>
        <div className="row-actions">
          <button className="btn-ghost"><FtIcon name="download" size={14}/> Esporta</button>
          <button className="btn-primary" onClick={goNewMachine}><FtIcon name="plus" size={14}/> Nuova macchina</button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search wide">
          <FtIcon name="search" size={14} color="var(--muted)"/>
          <input placeholder="Cerca matricola, job, cliente, paese…" value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        <div className="filters">
          <button className={'chip-btn' + (statusFilter === 'all' ? ' active' : '')} onClick={() => setStatusFilter('all')}>Tutte</button>
          {Object.entries(A_STATUS_META).map(([k, v]) => (
            <button key={k} className={'chip-btn' + (statusFilter === k ? ' active' : '')} onClick={() => setStatusFilter(k)}>
              <span className="badge-dot" style={{ background: v.dot }}></span> {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card no-pad">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID Fascicolo</th>
              <th>Job</th>
              <th>Modello</th>
              <th>Cliente</th>
              <th>Paese</th>
              <th>Anno</th>
              <th>Stato</th>
              <th>Avanzamento</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.id} onClick={() => goMachine(m.id)}>
                <td className="mono">{m.id}</td>
                <td className="mono muted">{m.job}</td>
                <td>{m.model}</td>
                <td>{m.customer}</td>
                <td><div className="country-cell"><A_CountryDot code={m.countryCode}/> <span>{m.country}</span></div></td>
                <td className="mono">{m.year}</td>
                <td><A_StatusBadge status={m.status}/></td>
                <td>
                  <div className="row-progress">
                    <div className="row-progress-bar"><span style={{ width: m.progress + '%', background: A_STATUS_META[m.status].color }}></span></div>
                    <span className="mono small">{m.progress}%</span>
                  </div>
                </td>
                <td><FtIcon name="chev-right" size={16} color="var(--muted)"/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const PeopleView = () => {
  const people = [
    { name: 'Mario Rossi', role: 'Capo officina', initials: 'MR', signs: 47, last: '2026-04-30' },
    { name: 'Aldo Verdi', role: 'Operatore montaggio', initials: 'AV', signs: 124, last: '2026-04-22' },
    { name: 'Lorenzo Bianchi', role: 'Operatore montaggio', initials: 'LB', signs: 89, last: '2026-04-12' },
    { name: 'Paolo Costa', role: 'Cablatore elettrico', initials: 'PC', signs: 62, last: '2026-04-08' },
    { name: 'Giulio Marini', role: 'Programmatore HMI', initials: 'GM', signs: 28, last: '2026-03-22' },
    { name: 'Francesco Greco', role: 'Collaudatore', initials: 'FG', signs: 38, last: '2026-04-30' },
    { name: 'Davide Ferrari', role: 'Tecnico campo', initials: 'DF', signs: 71, last: '2026-04-30' },
  ];
  return (
    <div className="view">
      <div className="view-header">
        <div><h1>Persone & Firme</h1><p className="muted">Operatori autorizzati a firmare interventi</p></div>
        <button className="btn-primary"><FtIcon name="plus" size={14}/> Nuovo operatore</button>
      </div>
      <div className="card no-pad">
        <table className="data-table">
          <thead><tr><th>Nome</th><th>Ruolo</th><th>Firme registrate</th><th>Ultima firma</th><th>PIN attivo</th><th></th></tr></thead>
          <tbody>
            {people.map((p, i) => (
              <tr key={i}>
                <td><div className="person-cell"><div className="user-avatar small">{p.initials}</div><span>{p.name}</span></div></td>
                <td>{p.role}</td>
                <td className="mono">{p.signs}</td>
                <td className="mono">{p.last}</td>
                <td><span className="badge"><span className="badge-dot" style={{ background: '#10b981' }}></span> Attivo</span></td>
                <td><button className="btn-ghost-sm">Modifica</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

window.App = App;
