/* eslint-disable */
const { useState: useS4, useEffect: useE4, useRef: useR4 } = React;

const CANTIERI_COORDS = {
  "C-031": [45.5416, 10.2118],
  "C-018": [45.1332, 10.0228],
  "C-044": [45.4064, 11.8768],
  "C-022": [43.6158, 13.5189],
  "C-009": [40.6824, 14.7681],
  "C-051": [37.5079, 15.0830],
};

const SLA_VALUES = ["99.2%","98.7%","99.5%","97.8%","99.1%","98.4%"];

// ---------- PIANIFICAZIONE (Gantt) ----------
function Pianificazione() {
  const days = [
    {n: 5, d: "lun", we: false, today: false},
    {n: 6, d: "mar", we: false, today: false},
    {n: 7, d: "mer", we: false, today: false},
    {n: 8, d: "gio", we: false, today: false},
    {n: 9, d: "ven", we: false, today: false},
    {n: 10, d: "sab", we: true, today: false},
    {n: 11, d: "dom", we: true, today: false},
    {n: 12, d: "lun", we: false, today: true},
    {n: 13, d: "mar", we: false, today: false},
    {n: 14, d: "mer", we: false, today: false},
    {n: 15, d: "gio", we: false, today: false},
    {n: 16, d: "ven", we: false, today: false},
    {n: 17, d: "sab", we: true, today: false},
    {n: 18, d: "dom", we: true, today: false},
  ];

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Pianificazione tecnici</h1>
          <div className="page-sub">Settimana 19–20 · 5 tecnici · 14 interventi pianificati</div>
        </div>
        <div className="flex gap-2">
          <button className="btn"><Icon name="filter" size={14}/> Per tecnico</button>
          <button className="btn"><Icon name="calendar" size={14}/> Vista mese</button>
          <button className="btn accent"><Icon name="plus" size={14}/> Pianifica</button>
        </div>
      </div>

      <div className="flex aic gap-2" style={{marginBottom: 14}}>
        <button className="btn sm"><Icon name="chevron" size={12} style={{transform:"rotate(180deg)"}}/></button>
        <strong style={{fontSize: 14}}>5 — 18 maggio 2026</strong>
        <button className="btn sm"><Icon name="chevron" size={12}/></button>
        <span style={{flex: 1}}></span>
        <span className="pill blue"><span className="dot"></span>Sopralluogo</span>
        <span className="pill amber"><span className="dot"></span>Manutenzione</span>
        <span className="pill green"><span className="dot"></span>Programmata</span>
        <span className="pill red"><span className="dot"></span>P1 / Urgente</span>
        <span className="pill purple"><span className="dot"></span>Audit</span>
      </div>

      <div className="gantt">
        <div className="gantt-head">
          <div style={{padding: "10px 14px", fontSize: 12, fontWeight: 700, textTransform:"uppercase", letterSpacing: "0.05em", color:"var(--text-3)"}}>Tecnico</div>
          <div className="gantt-days">
            {days.map((d, i) => (
              <div key={i} className={`gantt-day ${d.today ? "today" : ""} ${d.we ? "weekend" : ""}`}>
                <div>{d.d}</div>
                <div className="num">{d.n}</div>
              </div>
            ))}
          </div>
        </div>
        {D.gantt.map((row) => {
          const tec = tecMap[row.tech];
          return (
            <div className="gantt-row" key={row.tech}>
              <div className="gantt-tech">
                <Avatar initials={tec.iniziali} color={tec.colore === "amber" ? 50 : tec.colore === "blue" ? 240 : tec.colore === "green" ? 152 : tec.colore === "purple" ? 295 : 25}/>
                <div>
                  <div style={{fontWeight: 600, fontSize: 13}}>{tec.nome}</div>
                  <div style={{fontSize: 11.5, color: "var(--text-3)"}}>{tec.zona}</div>
                </div>
              </div>
              <div className="gantt-cells">
                {days.map((d, i) => (
                  <div key={i} className={`gantt-cell ${d.today ? "today" : ""} ${d.we ? "weekend" : ""}`}></div>
                ))}
                {row.blocks.map((b, i) => (
                  <div key={i} className={`gantt-block ${b.color}`} style={{
                    left: `calc(${b.day} * (100% / 14) + 4px)`,
                    width: `calc(${b.len} * (100% / 14) - 8px)`,
                  }}>
                    <div className="b-title" style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{b.label}</div>
                    <div className="b-meta">{b.len} {b.len === 1 ? "giorno" : "giorni"}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="row-3" style={{marginTop: 16}}>
        <div className="card">
          <div className="card-head"><div className="card-title">Carico settimanale</div></div>
          <div className="card-body">
            {D.tecnici.map(t => {
              const load = t.id === "T-01" ? 0.85 : t.id === "T-02" ? 0.72 : t.id === "T-03" ? 0.68 : t.id === "T-04" ? 0.55 : 0.91;
              return (
                <div key={t.id} style={{marginBottom: 10}}>
                  <div className="flex aic jcb" style={{fontSize: 13}}>
                    <span style={{fontWeight: 600}}>{t.nome}</span>
                    <span className="mono">{Math.round(load*100)}%</span>
                  </div>
                  <div className="urgency-bar" style={{marginTop: 4}}>
                    <div style={{width: `${load*100}%`, background: load > 0.85 ? "var(--red)" : load > 0.7 ? "var(--accent)" : "var(--green)"}}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Da assegnare</div></div>
          <div className="list">
            {D.interventi.filter(i => !i.tecnico).map(i => (
              <div className="list-item" key={i.id} style={{padding: "10px 16px"}}>
                <span className={`prio p${i.priorita}`}>P{i.priorita}</span>
                <div>
                  <div style={{fontWeight: 600, fontSize: 13}}>{i.titolo}</div>
                  <div style={{fontSize: 11.5, color: "var(--text-3)"}}>{i.cliente}</div>
                </div>
                <button className="btn sm">Assegna</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Conflitti rilevati</div></div>
          <div className="card-body" style={{display: "flex", flexDirection:"column", gap: 10}}>
            <div style={{padding: 10, borderRadius: 8, background: "var(--red-soft)", border: "1px solid transparent"}}>
              <div style={{fontSize: 12.5, fontWeight: 700, color: "var(--red)"}}>Sovrapposizione</div>
              <div style={{fontSize: 12, color: "var(--text-2)", marginTop: 2}}>Ilaria Manzo: 2 interventi mer 14 mag</div>
            </div>
            <div style={{padding: 10, borderRadius: 8, background: "var(--yellow-soft)", border: "1px solid transparent"}}>
              <div style={{fontSize: 12.5, fontWeight: 700, color: "oklch(0.45 0.13 88)"}}>Distanza eccessiva</div>
              <div style={{fontSize: 12, color: "var(--text-2)", marginTop: 2}}>Davide Greco: Salerno → Padova in 2 giorni</div>
            </div>
            <div style={{padding: 10, borderRadius: 8, background: "var(--blue-soft)", border: "1px solid transparent"}}>
              <div style={{fontSize: 12.5, fontWeight: 700, color: "var(--blue)"}}>Suggerimento AI</div>
              <div style={{fontSize: 12, color: "var(--text-2)", marginTop: 2}}>Sposta INT-2476 a Sara Conti per ottimizzare percorso</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- MAPPA ----------
function Mappa() {
  const [sel, setSel] = useS4("C-031");
  const mapDivRef = useR4(null);
  const leafletRef = useR4(null);

  // Init Leaflet once on mount
  useE4(() => {
    if (!mapDivRef.current || leafletRef.current) return;

    const map = L.map(mapDivRef.current, { center: [42.5, 12.5], zoom: 6, zoomControl: true });

    // CartoDB Positron — clean, neutral, Google Maps-like
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    D.cantieri.forEach(p => {
      const latlng = CANTIERI_COORDS[p.id];
      if (!latlng) return;
      const hex = p.stato === "alert" ? "#e5534b" : p.stato === "in_corso" ? "#d97757" : "#3aa17d";
      const ring = p.stato === "alert"
        ? `<div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid ${hex};opacity:0.35;animation:mapRing 1.8s ease-out infinite;"></div>` : "";

      const icon = L.divIcon({
        className: "",
        html: `
          <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
            ${ring}
            <div style="width:44px;height:44px;background:${hex};border:3px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;box-shadow:0 3px 10px rgba(0,0,0,0.22);position:relative;z-index:1;">${p.label}</div>
            <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${hex};margin-top:-2px;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.15));"></div>
          </div>`,
        iconSize: [44, 60],
        iconAnchor: [22, 60],
        popupAnchor: [0, -64],
      });

      L.marker(latlng, { icon })
        .addTo(map)
        .bindTooltip(`<strong>${p.cliente}</strong><br/>${p.stato === "alert" ? "⚠️ Alert attivo" : p.stato === "in_corso" ? "🔧 Intervento in corso" : "✅ Operativo"}`,
          { direction: "top", offset: [0, -62], className: "leaflet-tooltip-frantum" })
        .on("click", () => setSel(p.id));
    });

    leafletRef.current = map;
    return () => { leafletRef.current.remove(); leafletRef.current = null; };
  }, []);

  // Pan to selected cantiere
  useE4(() => {
    if (!leafletRef.current) return;
    const latlng = CANTIERI_COORDS[sel];
    if (latlng) leafletRef.current.flyTo(latlng, 9, { animate: true, duration: 0.9 });
  }, [sel]);

  const cantiere = D.cantieri.find(c => c.id === sel);

  return (
    <div className="content">
      <style>{`
        @keyframes mapRing { 0%{transform:scale(1);opacity:0.5} 100%{transform:scale(2.4);opacity:0} }
        .leaflet-tooltip-frantum {
          font-family: var(--sans); font-size: 12.5px; font-weight: 500;
          border-radius: 8px; border: 1px solid var(--border);
          padding: 7px 11px; box-shadow: var(--shadow);
          background: var(--surface); color: var(--text);
          line-height: 1.4;
        }
        .leaflet-tooltip-frantum::before { display: none; }
        .leaflet-control-attribution { font-size: 10px !important; }
      `}</style>

      <div className="page-head">
        <div>
          <h1 className="page-title">Mappa cantieri</h1>
          <div className="page-sub">6 stabilimenti attivi · 11 interventi in corso o pianificati</div>
        </div>
        <div className="flex gap-2">
          <button className="btn"><Icon name="filter" size={14}/> Filtra stato</button>
          <button className="btn"><Icon name="truck" size={14}/> Tecnici live</button>
        </div>
      </div>

      <div style={{display: "grid", gridTemplateColumns: "1fr 360px", gap: 14}}>

        {/* Leaflet map */}
        <div style={{borderRadius: "var(--r-lg)", overflow: "hidden", border: "1px solid var(--border)", boxShadow: "var(--shadow)", height: 620}}>
          <div ref={mapDivRef} style={{width: "100%", height: "100%"}}></div>
        </div>

        {/* Right column */}
        <div className="col gap-3">
          {/* Legend */}
          <div className="card">
            <div className="card-body" style={{padding: "11px 16px", display:"flex", gap: 16, flexWrap: "wrap", fontSize: 12.5}}>
              <span className="flex aic gap-2"><span style={{width:10,height:10,borderRadius:"50%",background:"var(--red)"}}></span> Alert attivo</span>
              <span className="flex aic gap-2"><span style={{width:10,height:10,borderRadius:"50%",background:"var(--accent)"}}></span> Intervento in corso</span>
              <span className="flex aic gap-2"><span style={{width:10,height:10,borderRadius:"50%",background:"var(--green)"}}></span> Operativo</span>
            </div>
          </div>

          {/* Detail card */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{cantiere.cliente}</div>
                <div className="card-sub">{cantiere.label} · ID {cantiere.id}</div>
              </div>
              <span className={`pill ${cantiere.stato === "alert" ? "red" : cantiere.stato === "in_corso" ? "amber" : "green"}`}>
                <span className="dot"></span>
                {cantiere.stato === "alert" ? "Alert attivo" : cantiere.stato === "in_corso" ? "In corso" : "Operativo"}
              </span>
            </div>
            <div className="card-body">
              <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14}}>
                <div><div className="field-label">Impianti</div><div style={{fontWeight:700,fontSize:18}} className="mono">{cantiere.attivi+1}</div></div>
                <div><div className="field-label">Aperti</div><div style={{fontWeight:700,fontSize:18,color:"var(--accent)"}} className="mono">{cantiere.attivi}</div></div>
                <div><div className="field-label">SLA</div><div style={{fontWeight:700,fontSize:18,color:"var(--green)"}} className="mono">99.2%</div></div>
              </div>
              <div className="divider"></div>
              <div className="field-label">Interventi recenti</div>
              <div className="list" style={{margin:"8px -18px -18px"}}>
                {D.interventi.filter(i => i.cliente.toLowerCase().includes(cantiere.cliente.split(" ")[0].toLowerCase())).slice(0,3).map(i => (
                  <div className="list-item" key={i.id} style={{padding:"10px 18px"}}>
                    <span className="mono" style={{fontSize:11,color:"var(--text-3)"}}>{i.id}</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:600}}>{i.titolo}</div>
                      <div style={{fontSize:11.5,color:"var(--text-3)"}}>{i.eta}</div>
                    </div>
                    <span className={`pill ${stageStyles[i.stato].pill}`}>{stageStyles[i.stato].nome}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Site list */}
          <div className="card">
            <div className="card-head"><div className="card-title" style={{fontSize:13}}>Tutti i cantieri</div></div>
            <div className="list">
              {D.cantieri.map(c => (
                <button key={c.id} onClick={() => setSel(c.id)}
                  style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:10,padding:"10px 16px",
                    borderBottom:"1px solid var(--border)",background:c.id===sel?"var(--accent-soft)":"transparent",
                    border:"0",borderBottom:"1px solid var(--border)",width:"100%",cursor:"pointer",textAlign:"left",alignItems:"center"}}>
                  <span style={{width:10,height:10,borderRadius:"50%",flexShrink:0,
                    background:c.stato==="alert"?"var(--red)":c.stato==="in_corso"?"var(--accent)":"var(--green)"}}></span>
                  <span style={{fontWeight:600,fontSize:13}}>{c.cliente}</span>
                  <span className="mono" style={{fontSize:11,color:"var(--text-3)"}}>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- CLIENTI ----------
function Clienti() {
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Clienti</h1>
          <div className="page-sub">{D.clienti.length} aziende · 13 stabilimenti monitorati</div>
        </div>
        <div className="flex gap-2">
          <button className="btn"><Icon name="filter" size={14}/> Filtri</button>
          <button className="btn accent"><Icon name="plus" size={14}/> Nuovo cliente</button>
        </div>
      </div>
      <div className="card" style={{overflow: "hidden"}}>
        <table className="tbl">
          <thead>
            <tr><th>Codice</th><th>Cliente</th><th>Sede</th><th>Impianti</th><th>Contratto</th><th>Telefono</th><th>SLA YTD</th><th></th></tr>
          </thead>
          <tbody>
            {D.clienti.map((c, idx) => (
              <tr key={c.id}>
                <td className="mono" style={{color:"var(--text-3)"}}>{c.id}</td>
                <td><div className="flex aic gap-2"><Avatar initials={c.nome.split(" ").map(w => w[0]).slice(0,2).join("")}/><strong>{c.nome}</strong></div></td>
                <td>{c.citta}</td>
                <td className="mono tnum">{c.impianti}</td>
                <td><span className={`pill ${c.contratto === "Premium" ? "amber" : "blue"}`}>{c.contratto}</span></td>
                <td className="mono" style={{fontSize: 12}}>{c.tel}</td>
                <td className="mono tnum" style={{color: "var(--green)"}}>{SLA_VALUES[idx]}</td>
                <td><button className="btn sm ghost"><Icon name="chevron" size={12}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- RAPPORTINI ----------
function Rapportini() {
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Rapportino — INT-2470</h1>
          <div className="page-sub">Riparazione nastro trasportatore N3 · Siderurgica Sicula · Catania</div>
        </div>
        <div className="flex gap-2">
          <button className="btn"><Icon name="doc" size={14}/> PDF</button>
          <button className="btn accent"><Icon name="check" size={14}/> Invia per firma</button>
        </div>
      </div>
      <div style={{display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16}}>
        <div className="card">
          <div className="card-head"><div className="card-title">Dati intervento</div></div>
          <div className="card-body" style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14}}>
            <div><div className="field-label">Cliente</div><div style={{fontWeight: 600}}>Siderurgica Sicula S.r.l.</div></div>
            <div><div className="field-label">Sede</div><div style={{fontWeight: 600}}>Catania (CT)</div></div>
            <div><div className="field-label">Impianto</div><div style={{fontWeight: 600}}>Nastro trasportatore N3</div></div>
            <div><div className="field-label">Tipologia</div><div style={{fontWeight: 600}}>Riparazione meccanica · P1</div></div>
            <div><div className="field-label">Tecnico</div><div className="flex aic gap-2"><Avatar initials="IM" size="sm" color={25}/><strong>Ilaria Manzo</strong></div></div>
            <div><div className="field-label">Inizio · Fine</div><div className="mono" style={{fontWeight: 600}}>09:15 — 11:00</div></div>
            <div style={{gridColumn: "span 2"}}>
              <div className="field-label">Descrizione attività eseguita</div>
              <div style={{padding: 12, background: "var(--bg-2)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13.5, lineHeight: 1.55}}>
                Sostituzione di un tratto di tappeto del nastro N3 per usura localizzata (segmento 4 di 6, lunghezza 3,2 m). Verifica allineamento rulli motori e tendinastro. Lubrificazione cuscinetti rulli folle. Test di marcia a vuoto 15 min e a carico 20 min: vibrazioni rientrate nei parametri (&lt; 4,5 mm/s).
              </div>
            </div>
            <div style={{gridColumn: "span 2"}}>
              <div className="field-label">Ricambi utilizzati</div>
              <table className="tbl" style={{border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden"}}>
                <thead><tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th><th>Note</th></tr></thead>
                <tbody>
                  <tr><td className="mono">RIC-NT-340</td><td>Tappeto EP 400/3 con rivestimento 4+2</td><td className="mono">1</td><td>tratto da 3,2m</td></tr>
                  <tr><td className="mono">RIC-CB-018</td><td>Cuscinetto a sfere 6206-2RS</td><td className="mono">2</td><td>rulli folle</td></tr>
                  <tr><td className="mono">RIC-LB-002</td><td>Grasso EP-2 (cartuccia 400g)</td><td className="mono">1</td><td>—</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col gap-4">
          <div className="card">
            <div className="card-head"><div className="card-title">Foto cantiere</div><span className="card-sub">8 file · 14 MB</span></div>
            <div className="card-body">
              <div className="photo-grid">
                {["Pre N3","Usura tappeto","Smontaggio","Cuscinetti","Nuovo tratto","Allineamento","Test","Post N3"].map(l => (
                  <div className="photo-tile" key={l}><span className="lbl">{l}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div className="card-title">Firma cliente</div><span className="card-sub">Stefano Greco · 10/05 11:08</span></div>
            <div className="card-body">
              <div className="signpad">
                <svg viewBox="0 0 300 120" preserveAspectRatio="none" style={{width: "100%", height: "100%"}}>
                  <path d="M20 80 Q40 30 60 70 T100 60 Q120 100 140 50 T180 70 Q210 40 230 80 T280 60"
                        fill="none" stroke="oklch(0.3 0.05 240)" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex aic jcb" style={{marginTop: 10}}>
                <span className="pill green"><Icon name="check" size={11}/> Firmato digitalmente</span>
                <span className="mono" style={{fontSize: 11, color: "var(--text-3)"}}>SHA256 · 4f8e...c2a1</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- DOCUMENTI ----------
function Documenti() {
  const docs = [
    { tipo: "Foto", titolo: "Cantiere N3 — pre intervento", data: "10/05/2026 09:18", size: "12.4 MB", da: "Ilaria Manzo" },
    { tipo: "PDF", titolo: "Rapportino INT-2469", data: "10/05/2026 13:02", size: "248 KB", da: "Luca Rossi" },
    { tipo: "Foto", titolo: "Martelli usurati M3", data: "10/05/2026 13:44", size: "3.8 MB", da: "Giuseppe Marino" },
    { tipo: "PDF", titolo: "Manuale frantoio F2 rev.5", data: "06/05/2026", size: "8.1 MB", da: "Sistema" },
    { tipo: "DOC", titolo: "Preventivo INT-2485", data: "08/05/2026", size: "112 KB", da: "Elena Russo" },
  ];
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Documenti &amp; foto</h1>
          <div className="page-sub">Tutti i file degli interventi recenti</div>
        </div>
        <div className="flex gap-2"><button className="btn"><Icon name="folder" size={14}/> Cartelle</button><button className="btn accent"><Icon name="plus" size={14}/> Carica</button></div>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Tipo</th><th>Nome</th><th>Caricato il</th><th>Dimensione</th><th>Da</th></tr></thead>
          <tbody>
            {docs.map((d, i) => (
              <tr key={i}>
                <td><span className="pill" style={{background: d.tipo==="Foto"?"var(--blue-soft)":d.tipo==="PDF"?"var(--red-soft)":"var(--purple-soft)", color: d.tipo==="Foto"?"var(--blue)":d.tipo==="PDF"?"var(--red)":"var(--purple)", border:0}}>{d.tipo}</span></td>
                <td style={{fontWeight: 600}}>{d.titolo}</td>
                <td className="mono" style={{fontSize: 12}}>{d.data}</td>
                <td className="mono tnum">{d.size}</td>
                <td>{d.da}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- NOTIFICHE ----------
function Notifiche() {
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Notifiche</h1>
          <div className="page-sub">Centro alert · ultime 24 ore</div>
        </div>
        <div className="flex gap-2"><button className="btn"><Icon name="check" size={14}/> Segna tutto come letto</button></div>
      </div>
      <div className="card">
        <div className="card-body">
          {D.notifiche.map(n => {
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
                <button className="btn sm ghost">Apri</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.Pianificazione = Pianificazione;
window.Mappa = Mappa;
window.Clienti = Clienti;
window.Rapportini = Rapportini;
window.Documenti = Documenti;
window.Notifiche = Notifiche;
