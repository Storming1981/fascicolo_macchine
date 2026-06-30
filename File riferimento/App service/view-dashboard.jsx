/* eslint-disable */
const { useState, useEffect, useMemo, useRef } = React;
const D = window.AppData;

// ---------- helpers ----------
const stageStyles = {
  nuovo:       { pill: "blue",   stripe: "var(--blue)",   nome: "Nuovo" },
  pianificato: { pill: "purple", stripe: "var(--purple)", nome: "Pianificato" },
  in_corso:    { pill: "amber",  stripe: "var(--accent)", nome: "In corso" },
  completato:  { pill: "green",  stripe: "var(--green)",  nome: "Completato" },
  fatturato:   { pill: "amber",  stripe: "var(--text-3)", nome: "Fatturato" },
};
const tecMap = Object.fromEntries(D.tecnici.map(t => [t.id, t]));

const Avatar = ({ initials, size = "", color = "" }) => (
  <div className={`avatar ${size}`} style={color ? {
    background: `oklch(0.94 0.05 ${color})`,
    color: `oklch(0.4 0.12 ${color})`
  } : null}>{initials}</div>
);

// ---------- DASHBOARD ----------
function Dashboard({ goto }) {
  const kpis = [
    { label: "Interventi aperti",     value: "47",   trend: "+6", dir: "up",   spark: "M0 18 L10 14 L20 16 L30 8 L40 10 L50 4 L60 6 L70 2 L80 4", color: "var(--blue)" },
    { label: "Tecnici on-site",       value: "5/7",  trend: "stabile", dir: "flat", spark: "M0 14 L20 12 L40 14 L60 10 L80 12", color: "var(--accent)" },
    { label: "SLA a rischio",         value: "3",    trend: "+1", dir: "down", spark: "M0 12 L20 16 L40 14 L60 8 L80 4", color: "var(--red)" },
    { label: "Fatturato mese",        value: "€84.2K", trend: "+12%", dir: "up", spark: "M0 22 L10 18 L20 20 L30 14 L40 16 L50 8 L60 10 L70 4 L80 2", color: "var(--green)" },
  ];

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Buongiorno, Elena 👷‍♀️</h1>
          <div className="page-sub">Lunedì 10 maggio · 5 tecnici operativi · 3 SLA in scadenza nelle prossime 2h</div>
        </div>
        <div className="flex gap-2">
          <button className="btn"><Icon name="filter"/> Filtra periodo</button>
          <button className="btn accent" onClick={() => goto("interventi")}><Icon name="plus" size={14}/> Nuovo intervento</button>
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid">
        {kpis.map(k => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value tnum">{k.value}</div>
            <div className={`kpi-trend ${k.dir}`}>
              {k.dir === "up" && <Icon name="arrowUp" size={12}/>}
              {k.dir === "down" && <Icon name="arrowDown" size={12}/>}
              {k.trend} vs settimana scorsa
            </div>
            <svg className="spark" viewBox="0 0 80 24" preserveAspectRatio="none">
              <path d={k.spark} fill="none" stroke={k.color} strokeWidth="1.6"/>
            </svg>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="card" style={{marginBottom: "var(--gap)"}}>
        <div className="card-head">
          <div>
            <div className="card-title">Pipeline interventi</div>
            <div className="card-sub">Stato dei 47 interventi attivi</div>
          </div>
          <button className="btn sm ghost" onClick={() => goto("interventi")}>Vedi tutti <Icon name="chevron" size={12}/></button>
        </div>
        <div className="card-body">
          <div className="pipeline">
            {D.stages.map(s => (
              <div className={`pipe s-${s.key.slice(0,4)}`} key={s.key}>
                <div className="pipe-name">{s.nome}</div>
                <div className="pipe-count tnum">{s.count}</div>
                <div className="pipe-meta">{
                  s.key === "in_corso" ? "2 tecnici al lavoro" :
                  s.key === "nuovo" ? "1 P1 da assegnare" :
                  s.key === "pianificato" ? "Prossimo: oggi 14:00" :
                  s.key === "completato" ? "1 in attesa firma" :
                  "€12.4K da incassare"
                }</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row-2-1">
        {/* Live chat feed */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Conversazioni in arrivo</div>
              <div className="card-sub">WhatsApp · Telegram · ultimi messaggi clienti</div>
            </div>
            <button className="btn sm ghost" onClick={() => goto("chat")}>Apri inbox <Icon name="chevron" size={12}/></button>
          </div>
          <div className="list">
            {D.conversazioni.slice(0,4).map(c => (
              <div className="list-item" key={c.id}>
                <div className="conv-avatar" style={{width: 36, height: 36, fontSize: 12}}>
                  {c.iniziali}
                  <div className={`conv-channel ${c.canale}`}><Icon name={c.canale} size={9}/></div>
                </div>
                <div style={{minWidth: 0}}>
                  <div className="flex aic gap-2">
                    <strong style={{fontSize: 13.5}}>{c.contatto}</strong>
                    {c.urgenza > 0.6 && <span className="pill red"><Icon name="sparkle" size={10}/> Urgenza alta</span>}
                  </div>
                  <div style={{fontSize: 12.5, color: "var(--text-2)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{c.anteprima}</div>
                </div>
                <div className="col" style={{alignItems: "flex-end", gap: 4}}>
                  <span className="mono" style={{fontSize: 11, color: "var(--text-3)"}}>{c.ora}</span>
                  {c.nonLetti > 0 && <span className="unread">{c.nonLetti}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alert / SLA feed */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Alert &amp; SLA</div>
              <div className="card-sub">Ultime 2 ore</div>
            </div>
            <button className="btn sm ghost"><Icon name="settings" size={12}/></button>
          </div>
          <div className="card-body" style={{paddingTop: 6, paddingBottom: 6}}>
            {D.notifiche.slice(0,5).map(n => {
              const tone = n.tipo === "alert" ? "red" : n.tipo === "warn" ? "amber" : n.tipo === "ok" ? "green" : "blue";
              const ic = n.icona === "alert" ? "flag" : n.icona === "chat" ? "chat" : n.icona === "tech" ? "tools" : n.icona === "ok" ? "check" : n.icona === "doc" ? "doc" : "clock";
              return (
                <div className="notif" key={n.id}>
                  <div className={`notif-icon pill ${tone}`} style={{padding:0}}><Icon name={ic} size={14}/></div>
                  <div className="notif-body">
                    <div style={{fontWeight: 600}}>{n.titolo}</div>
                    <div style={{color: "var(--text-3)", fontSize: 12}}>{n.desc}</div>
                    <div className="notif-time">{n.ora}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mappa preview + tecnici */}
      <div className="row-2" style={{marginTop: "var(--gap)"}}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Cantieri attivi</div>
              <div className="card-sub">6 stabilimenti · 11 interventi in corso o pianificati</div>
            </div>
            <button className="btn sm ghost" onClick={() => goto("mappa")}>Apri mappa <Icon name="chevron" size={12}/></button>
          </div>
          <div className="card-body" style={{padding: 0}}>
            <MapMini />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Squadra oggi</div>
              <div className="card-sub">Disponibilità tecnici</div>
            </div>
          </div>
          <div className="list">
            {D.tecnici.map(t => (
              <div className="list-item" key={t.id}>
                <Avatar initials={t.iniziali} color={
                  t.colore === "amber" ? 50 : t.colore === "blue" ? 240 : t.colore === "green" ? 152 : t.colore === "purple" ? 295 : 25
                }/>
                <div>
                  <div style={{fontWeight: 600}}>{t.nome}</div>
                  <div style={{fontSize: 12, color: "var(--text-3)"}}>{t.ruolo} · {t.zona}</div>
                </div>
                <span className={`pill ${t.id === "T-05" || t.id === "T-02" ? "amber" : "green"}`}>
                  <span className="dot"></span>
                  {t.id === "T-05" ? "On-site" : t.id === "T-02" ? "On-site" : "Disponibile"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const MINI_COORDS = {
  "C-031": [45.5416, 10.2118],
  "C-018": [45.1332, 10.0228],
  "C-044": [45.4064, 11.8768],
  "C-022": [43.6158, 13.5189],
  "C-009": [40.6824, 14.7681],
  "C-051": [37.5079, 15.0830],
};

function MapMini() {
  const mapDivRef = useRef(null);
  const leafletRef = useRef(null);

  useEffect(() => {
    if (!mapDivRef.current || leafletRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: [42.5, 12.5],
      zoom: 5,
      zoomControl: false,
      scrollWheelZoom: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    D.cantieri.forEach(p => {
      const latlng = MINI_COORDS[p.id];
      if (!latlng) return;
      const hex = p.stato === "alert" ? "#e5534b" : p.stato === "in_corso" ? "#d97757" : "#3aa17d";
      const ring = p.stato === "alert"
        ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${hex};opacity:0.35;animation:mapRing 1.8s ease-out infinite;"></div>`
        : "";

      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center;">
          ${ring}
          <div style="width:32px;height:32px;background:${hex};border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.22);position:relative;z-index:1;">${p.label}</div>
          <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${hex};margin-top:-1px;"></div>
        </div>`,
        iconSize: [32, 46],
        iconAnchor: [16, 46],
        popupAnchor: [0, -50],
      });

      L.marker(latlng, { icon })
        .addTo(map)
        .bindTooltip(`<strong>${p.cliente}</strong>`, {
          direction: "top", offset: [0, -50],
          className: "leaflet-tooltip-frantum",
        });
    });

    leafletRef.current = map;
    return () => { leafletRef.current.remove(); leafletRef.current = null; };
  }, []);

  return (
    <div style={{height: 300, borderTop: "1px solid var(--border)", overflow: "hidden", borderRadius: "0 0 var(--r-lg) var(--r-lg)"}}>
      <style>{`@keyframes mapRing{0%{transform:scale(1);opacity:.5}100%{transform:scale(2.4);opacity:0}}`}</style>
      <div ref={mapDivRef} style={{width: "100%", height: "100%"}}></div>
    </div>
  );
}

window.Dashboard = Dashboard;
window.MapMini = MapMini;
window.stageStyles = stageStyles;
window.tecMap = tecMap;
window.Avatar = Avatar;
