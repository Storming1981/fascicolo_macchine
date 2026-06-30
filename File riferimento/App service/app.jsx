/* eslint-disable */
const { useState: useSA, useEffect: useEA } = React;

function Sidebar({ active, setActive }) {
  const items = [
    { key: "dashboard",     label: "Dashboard",      ico: "dashboard" },
    { key: "interventi",    label: "Interventi",     ico: "ticket", badge: 13 },
    { key: "chat",          label: "Chat unificata", ico: "chat", badge: 4 },
    { key: "pianificazione",label: "Pianificazione", ico: "calendar" },
    { key: "mappa",         label: "Mappa cantieri", ico: "map" },
    { key: "clienti",       label: "Clienti",        ico: "users" },
  ];
  const items2 = [
    { key: "rapportini",  label: "Rapportini",     ico: "sign" },
    { key: "documenti",   label: "Documenti & foto", ico: "image" },
    { key: "notifiche",   label: "Notifiche",      ico: "bell", badge: 6 },
  ];
  const Item = ({ it }) => (
    <button className={`nav-item ${active === it.key ? "active" : ""}`} onClick={() => setActive(it.key)}>
      <Icon name={it.ico} size={16}/>
      <span>{it.label}</span>
      {it.badge != null && <span className={`nav-badge ${active === it.key ? "" : "muted"}`}>{it.badge}</span>}
    </button>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">F</div>
        <div>
          <div className="brand-name">Frantum</div>
          <div className="brand-tag">Service Hub</div>
        </div>
      </div>
      <nav className="nav">
        <div className="nav-section">Operatività</div>
        {items.map(it => <Item it={it} key={it.key}/>)}
        <div className="nav-section">Documentazione</div>
        {items2.map(it => <Item it={it} key={it.key}/>)}
      </nav>
      <div className="user-card">
        <Avatar initials="ER" size="lg" color={50}/>
        <div style={{minWidth: 0, flex: 1}}>
          <div style={{fontWeight: 600, fontSize: 13}}>Elena Russo</div>
          <div style={{fontSize: 11, color: "var(--text-3)"}}>Dispatcher · Brescia HQ</div>
        </div>
        <button className="icon-btn" style={{height: 28, width: 28}}><Icon name="settings" size={14}/></button>
      </div>
    </aside>
  );
}

const TWEAKS_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "accentHue": 48,
  "interventiView": "kanban"
}/*EDITMODE-END*/;

function App() {
  const [active, setActive] = useSA("dashboard");
  const tweaks = window.useTweaks ? window.useTweaks(TWEAKS_DEFAULTS) : { t: TWEAKS_DEFAULTS, setTweak: () => {} };
  const t = tweaks.t || tweaks;
  const setTweak = tweaks.setTweak || (() => {});

  useEA(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-density", t.density);
    document.documentElement.style.setProperty("--accent", `oklch(0.64 0.16 ${t.accentHue})`);
    document.documentElement.style.setProperty("--accent-soft", `oklch(0.95 0.04 ${t.accentHue})`);
    document.documentElement.style.setProperty("--accent-fg", `oklch(0.32 0.10 ${t.accentHue})`);
  }, [t.theme, t.density, t.accentHue]);

  const titles = {
    dashboard: ["Frantum Service", ["Operatività","Dashboard"]],
    interventi: ["Interventi", ["Operatività","Interventi"]],
    chat: ["Chat unificata", ["Operatività","Chat"]],
    pianificazione: ["Pianificazione", ["Operatività","Pianificazione"]],
    mappa: ["Mappa cantieri", ["Operatività","Mappa"]],
    clienti: ["Anagrafica", ["Operatività","Clienti"]],
    rapportini: ["Rapportino", ["Documenti","Rapportino INT-2470"]],
    documenti: ["Documenti & foto", ["Documenti","Tutti i file"]],
    notifiche: ["Notifiche", ["Sistema","Centro notifiche"]],
  };
  const [_, crumbs] = titles[active];

  const View = {
    dashboard: <Dashboard goto={setActive}/>,
    interventi: <Interventi/>,
    chat: <Chat/>,
    pianificazione: <Pianificazione/>,
    mappa: <Mappa/>,
    clienti: <Clienti/>,
    rapportini: <Rapportini/>,
    documenti: <Documenti/>,
    notifiche: <Notifiche/>,
  }[active];

  return (
    <div className="app" data-screen-label={`Frantum · ${active}`}>
      <Sidebar active={active} setActive={setActive}/>
      <main className="main">
        <header className="topbar">
          <div className="crumbs">{crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="sep">/</span>}
              <span>{c}</span>
            </React.Fragment>
          ))}</div>
          <div className="topbar-spacer"></div>
          <div className="topbar-actions">
            <div className="search-wrap" style={{position: "relative"}}>
              <Icon name="search" size={14}/>
              <input className="search" placeholder="Cerca interventi, clienti, impianti..."/>
              <span className="kbd">⌘K</span>
            </div>
            <button className="icon-btn" title="Notifiche" onClick={() => setActive("notifiche")}>
              <Icon name="bell" size={16}/>
              <span className="dot"></span>
            </button>
            <button className="icon-btn" title="Impostazioni"><Icon name="settings" size={16}/></button>
            <Avatar initials="ER" color={50}/>
          </div>
        </header>
        <div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column"}}>
          {View}
        </div>
      </main>

      {window.TweaksPanel && (
        <window.TweaksPanel title="Tweaks">
          <window.TweakSection title="Tema">
            <window.TweakRadio label="Modalità" value={t.theme} onChange={v => setTweak("theme", v)}
                               options={[["light","Chiaro"],["dark","Scuro"]]}/>
            <window.TweakColor label="Colore accento" value={`oklch(0.64 0.16 ${t.accentHue})`}
              onChange={() => {}}
              options={[
                ["#d97757","Amber"],
                ["#5e8df3","Blu"],
                ["#3aa17d","Verde"],
                ["#a060d0","Viola"],
              ]}/>
            <window.TweakRadio label="Hue rapido" value={String(t.accentHue)} onChange={v => setTweak("accentHue", Number(v))}
                               options={[["48","Amber"],["240","Blu"],["152","Verde"],["295","Viola"]]}/>
          </window.TweakSection>
          <window.TweakSection title="Densità">
            <window.TweakRadio label="Spaziatura" value={t.density} onChange={v => setTweak("density", v)}
                               options={[["comfortable","Comoda"],["compact","Compatta"]]}/>
          </window.TweakSection>
          <window.TweakSection title="Vista interventi">
            <window.TweakRadio label="Layout default" value={t.interventiView} onChange={v => setTweak("interventiView", v)}
                               options={[["kanban","Kanban"],["lista","Lista"]]}/>
          </window.TweakSection>
          <window.TweakSection title="Vai a sezione">
            <div className="flex gap-1" style={{flexWrap: "wrap"}}>
              {Object.keys(titles).map(k => (
                <button key={k} className="qreply"
                        style={{textTransform: "capitalize", background: active === k ? "var(--accent-soft)" : "var(--bg-2)"}}
                        onClick={() => setActive(k)}>{k}</button>
              ))}
            </div>
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App/>);
