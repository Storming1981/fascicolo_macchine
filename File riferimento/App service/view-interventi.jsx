/* eslint-disable */
const { useState: useS2, useMemo: useM2 } = React;

// ---------- INTERVENTI (Kanban + List toggle) ----------
function Interventi() {
  const [view, setView] = useS2("kanban");
  const [filtro, setFiltro] = useS2("tutti");

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Interventi</h1>
          <div className="page-sub">13 attivi · 3 P1 da assegnare · ultimo aggiornamento 2 min fa</div>
        </div>
        <div className="flex gap-2">
          <button className="btn"><Icon name="filter" size={14}/> Filtri</button>
          <button className="btn"><Icon name="sort" size={14}/> Ordina</button>
          <button className="btn accent"><Icon name="plus" size={14}/> Nuovo intervento</button>
        </div>
      </div>

      <div className="flex aic jcb" style={{marginBottom: 16}}>
        <div className="tabs" style={{margin:0, border:0}}>
          {[
            ["tutti", "Tutti", 47],
            ["miei", "I miei", 12],
            ["p1", "Solo P1", 4],
            ["sla", "SLA a rischio", 3],
          ].map(([k, l, n]) => (
            <button key={k} className={`tab ${filtro===k?"active":""}`} onClick={() => setFiltro(k)}>
              {l} <span className="mono" style={{color:"var(--text-3)", marginLeft: 4, fontSize: 11}}>{n}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1" style={{background:"var(--surface)", border:"1px solid var(--border)", borderRadius: 8, padding: 3}}>
          {[["kanban","Kanban"],["lista","Lista"]].map(([k,l]) => (
            <button key={k} className={`tab ${view===k?"active":""}`} style={{
              border:0, padding: "6px 14px", borderRadius: 6,
              background: view===k? "var(--bg-2)":"transparent",
              borderBottom: 0
            }} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>

      {view === "kanban" ? <Kanban /> : <ListaInterventi />}
    </div>
  );
}

function Kanban() {
  return (
    <div className="kanban">
      {D.stages.map(stage => {
        const items = D.interventi.filter(i => i.stato === stage.key);
        return (
          <div className="kanban-col" key={stage.key}>
            <div className="kanban-head">
              <div className="kanban-stripe" style={{background: stage.stripe}}></div>
              <span className="kanban-name">{stage.nome}</span>
              <span className="kanban-count">{items.length}</span>
            </div>
            <div className="kanban-list">
              {items.map(i => <Ticket key={i.id} i={i}/>)}
              {stage.key === "nuovo" && (
                <button className="ticket" style={{
                  background:"transparent",
                  border: "1.5px dashed var(--border-strong)",
                  alignItems: "center", color: "var(--text-3)",
                  flexDirection:"row", gap: 6, justifyContent:"center"
                }}>
                  <Icon name="plus" size={14}/> Nuovo intervento
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Ticket({ i }) {
  const tec = i.tecnico ? tecMap[i.tecnico] : null;
  const prio = i.priorita === 1 ? "p1" : i.priorita === 2 ? "p2" : "p3";
  const prioLbl = i.priorita === 1 ? "P1 · CRITICO" : i.priorita === 2 ? "P2 · ALTO" : "P3 · NORMALE";
  return (
    <div className="ticket">
      <div className="flex aic jcb">
        <span className="ticket-id">{i.id}</span>
        <span className={`prio ${prio}`}>{prioLbl}</span>
      </div>
      <div className="ticket-title">{i.titolo}</div>
      <div className="ticket-meta">
        <span className="flex aic gap-1"><Icon name="factory" size={12}/>{i.impianto}</span>
      </div>
      <div className="ticket-meta">
        <span className="flex aic gap-1"><Icon name="users" size={12}/>{i.cliente}</span>
      </div>
      <div className="ticket-foot">
        <span className="pill" style={{background:"var(--bg-2)"}}>
          <Icon name={i.canale === "WhatsApp" ? "wa" : i.canale === "Telegram" ? "tg" : "chat"} size={11}
                style={{color: i.canale === "WhatsApp" ? "var(--wa)" : i.canale === "Telegram" ? "var(--tg)" : "var(--text-3)"}}/>
          <span className="mono" style={{fontSize: 10.5}}>{i.eta}</span>
        </span>
        {tec
          ? <Avatar initials={tec.iniziali} size="sm" color={tec.colore === "amber" ? 50 : tec.colore === "blue" ? 240 : tec.colore === "green" ? 152 : tec.colore === "purple" ? 295 : 25}/>
          : <span className="pill amber" style={{fontSize: 10.5}}>Da assegnare</span>}
      </div>
    </div>
  );
}

function ListaInterventi() {
  return (
    <div className="card" style={{overflow: "hidden"}}>
      <table className="tbl">
        <thead>
          <tr>
            <th>ID</th><th>Titolo</th><th>Cliente · Impianto</th><th>Stato</th><th>Priorità</th><th>Tecnico</th><th>Quando</th><th>Canale</th>
          </tr>
        </thead>
        <tbody>
          {D.interventi.map(i => {
            const tec = i.tecnico ? tecMap[i.tecnico] : null;
            const ss = stageStyles[i.stato];
            return (
              <tr key={i.id}>
                <td className="mono" style={{color:"var(--text-3)"}}>{i.id}</td>
                <td style={{fontWeight: 600}}>{i.titolo}</td>
                <td><div>{i.cliente}</div><div style={{color:"var(--text-3)", fontSize: 12}}>{i.impianto}</div></td>
                <td><span className={`pill ${ss.pill}`}><span className="dot"></span>{ss.nome}</span></td>
                <td><span className={`prio p${i.priorita}`}>P{i.priorita}</span></td>
                <td>{tec ? <div className="flex aic gap-2"><Avatar initials={tec.iniziali} size="sm" color={50}/>{tec.nome}</div> : <span className="pill amber">Da assegnare</span>}</td>
                <td className="mono" style={{fontSize: 12}}>{i.eta}</td>
                <td><Icon name={i.canale === "WhatsApp" ? "wa" : i.canale === "Telegram" ? "tg" : "chat"} size={14} style={{color: i.canale === "WhatsApp" ? "var(--wa)" : i.canale === "Telegram" ? "var(--tg)" : "var(--text-3)"}}/></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

window.Interventi = Interventi;
