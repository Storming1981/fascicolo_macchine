/* eslint-disable */
const { useState: useS3, useEffect: useE3, useRef: useR3 } = React;

// ---------- CHAT UNIFICATA WhatsApp + Telegram ----------
function Chat() {
  const [activeId, setActiveId] = useS3("CV-01");
  const [tab, setTab] = useS3("tutto");
  const [draft, setDraft] = useS3("");
  const messagesRef = useR3(null);

  const conv = D.conversazioni.find(c => c.id === activeId);
  const filtered = D.conversazioni.filter(c =>
    tab === "tutto" ? true : tab === "wa" ? c.canale === "wa" : tab === "tg" ? c.canale === "tg" : c.nonLetti > 0
  );

  useE3(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [activeId]);

  return (
    <div className="chat-shell">
      {/* INBOX */}
      <div className="chat-inbox">
        <div className="inbox-head">
          <div className="flex aic jcb" style={{marginBottom: 10}}>
            <strong style={{fontSize: 15}}>Inbox</strong>
            <button className="icon-btn" style={{height: 28, width: 28, borderRadius: 8}}><Icon name="plus" size={14}/></button>
          </div>
          <div className="search-wrap">
            <Icon name="search" size={14}/>
            <input className="search" style={{width:"100%"}} placeholder="Cerca cliente, parola, tag..."/>
          </div>
          <div className="inbox-tabs" style={{marginTop: 10}}>
            {[
              ["tutto", "Tutto", null, 7],
              ["wa", "WhatsApp", "wa", 4],
              ["tg", "Telegram", "tg", 3],
              ["unread", "Non letti", null, 4],
            ].map(([k,l,ic,n]) => (
              <button key={k} className={`inbox-tab ${tab===k?"active":""}`} onClick={() => setTab(k)}>
                {ic && <Icon name={ic} size={12} style={{color: ic==="wa"?"var(--wa)":"var(--tg)"}}/>}
                {l}
                <span className="mono" style={{fontSize: 10, color:"var(--text-3)"}}>{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="inbox-list">
          {filtered.map(c => (
            <button key={c.id}
                    className={`conv ${c.id === activeId ? "active" : ""}`}
                    onClick={() => setActiveId(c.id)}>
              <div className="conv-avatar">{c.iniziali}<div className={`conv-channel ${c.canale}`}><Icon name={c.canale} size={9}/></div></div>
              <div className="conv-body">
                <div className="conv-top">
                  <span className="conv-name">{c.contatto}</span>
                  <span className="conv-time">{c.ora}</span>
                </div>
                <div style={{fontSize: 11.5, color: "var(--text-3)"}}>{c.ruolo}</div>
                <div className="conv-preview">{c.anteprima}</div>
                <div className="conv-tags">
                  {c.tag.map(t => <span key={t} className="pill" style={{
                    fontSize: 10, padding: "0 7px",
                    background: t === "urgente" ? "var(--red-soft)" : "var(--bg-2)",
                    color: t === "urgente" ? "var(--red)" : "var(--text-2)",
                    border: 0
                  }}>{t}</span>)}
                </div>
              </div>
              <div className="conv-right">
                {c.nonLetti > 0 && <span className="unread">{c.nonLetti}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* THREAD */}
      <div className="chat-thread">
        <div className="chat-head">
          <div className="conv-avatar" style={{width: 40, height: 40, fontSize: 14}}>
            {conv.iniziali}
            <div className={`conv-channel ${conv.canale}`}><Icon name={conv.canale} size={9}/></div>
          </div>
          <div>
            <div style={{fontWeight: 700, fontSize: 14.5}}>{conv.contatto}</div>
            <div className="meta">
              <span>{conv.ruolo}</span>
              <span style={{opacity: 0.5}}>·</span>
              <Icon name={conv.canale} size={11} style={{color: conv.canale === "wa" ? "var(--wa)" : "var(--tg)"}}/>
              <span>{conv.canale === "wa" ? "WhatsApp Business" : "Telegram"}</span>
            </div>
          </div>
          <div className="actions">
            <button className="btn sm"><Icon name="phone" size={13}/> Chiama</button>
            <button className="btn sm"><Icon name="folder" size={13}/> Storico</button>
            <button className="icon-btn"><Icon name="settings" size={14}/></button>
          </div>
        </div>

        <div className="messages" ref={messagesRef}>
          <div className="msg-day">Oggi · 10 maggio</div>
          {conv.messaggi.map((m, idx) => (
            <div className={`msg ${m.da}`} key={idx}>
              {m.da === "in" && <div className="msg-author">{m.autore}</div>}
              {m.foto && <div className="msg-photo"><span className="label">📷 {m.foto}</span></div>}
              {m.testo && <div>{m.testo}</div>}
              <span className="msg-time">{m.ora}{m.da === "out" && " ✓✓"}</span>
            </div>
          ))}
        </div>

        <div className="composer-quick">
          <button className="qreply">⚡ Apro intervento P1</button>
          <button className="qreply">📅 Conferma appuntamento</button>
          <button className="qreply">🔧 Tecnico in arrivo</button>
          <button className="qreply">📄 Invia rapportino</button>
          <button className="qreply">+ Template</button>
        </div>

        <div className="chat-composer">
          <button className="icon-btn"><Icon name="paperclip" size={16}/></button>
          <textarea className="composer-input"
                    placeholder={`Rispondi a ${conv.contatto}...`}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={1}/>
          <div className="composer-actions">
            <button className="icon-btn"><Icon name="smile" size={16}/></button>
            <button className="icon-btn"><Icon name="mic" size={16}/></button>
            <button className="btn accent" disabled={!draft}><Icon name="send" size={14}/> Invia</button>
          </div>
        </div>
      </div>

      {/* AI PANEL */}
      <div className="ai-panel">
        <div className="ai-section">
          <div className="ai-title"><Icon name="bot" size={12}/> Analisi AI conversazione</div>

          <div className="ai-bar">
            <div className="ai-row">
              <span style={{fontSize: 12, color: "var(--text-2)"}}>Urgenza rilevata</span>
              <span className="mono" style={{fontWeight: 700, fontSize: 13, color:"var(--red)"}}>{Math.round(conv.urgenza*100)}%</span>
            </div>
            <div className="urgency-bar"><div style={{width: `${conv.urgenza*100}%`}}></div></div>
          </div>

          <div className="ai-bar">
            <div className="ai-row">
              <span style={{fontSize: 12, color: "var(--text-2)"}}>Categoria</span>
              <span style={{fontWeight: 600, fontSize: 12.5}}>{conv.tipo}</span>
            </div>
          </div>

          <div className="ai-bar">
            <div className="ai-row">
              <span style={{fontSize: 12, color: "var(--text-2)"}}>Sentiment</span>
              <span className="pill amber" style={{fontSize: 11}}>Preoccupato</span>
            </div>
          </div>
        </div>

        <div className="ai-section">
          <div className="ai-title"><Icon name="sparkle" size={12}/> Azione suggerita</div>
          <div className="ai-suggestion">
            <div style={{fontSize: 12.5, lineHeight: 1.5}}>
              Cliente <strong>P1</strong> con guasto bloccante. Apri intervento e assegna <strong>Marco Bianchi</strong> (più vicino, 38 km, già in zona).
            </div>
            <div className="flex gap-2" style={{marginTop: 10}}>
              <button className="btn accent sm" style={{flex: 1}}><Icon name="ticket" size={12}/> Crea intervento</button>
              <button className="btn sm"><Icon name="check" size={12}/></button>
            </div>
          </div>
          <button className="qreply" style={{width: "100%", textAlign:"left", padding: "8px 12px", marginTop: 6}}>
            💬 Suggerisci risposta automatica
          </button>
        </div>

        <div className="ai-section">
          <div className="ai-title"><Icon name="users" size={12}/> Contesto cliente</div>
          <div style={{fontSize: 13, fontWeight: 700}}>{D.clienti.find(x => x.id === conv.cliente)?.nome}</div>
          <div style={{fontSize: 12, color: "var(--text-3)", marginBottom: 10}}>Cliente Premium · 3 impianti · {D.clienti.find(x => x.id === conv.cliente)?.citta}</div>
          <div className="flex gap-2" style={{flexWrap:"wrap"}}>
            <span className="pill blue" style={{fontSize: 11}}>12 interventi 2025</span>
            <span className="pill green" style={{fontSize: 11}}>SLA 99.2%</span>
            <span className="pill amber" style={{fontSize: 11}}>2 P1 questo mese</span>
          </div>
        </div>

        <div className="ai-section">
          <div className="ai-title"><Icon name="ticket" size={12}/> Interventi collegati</div>
          {D.interventi.filter(i => i.cliente.includes("Acciai")).slice(0,2).map(i => (
            <div key={i.id} style={{padding: "8px 10px", border:"1px solid var(--border)", borderRadius: 8, marginBottom: 6, background:"var(--surface)"}}>
              <div className="flex aic jcb">
                <span className="mono" style={{fontSize: 10.5, color:"var(--text-3)"}}>{i.id}</span>
                <span className={`pill ${stageStyles[i.stato].pill}`} style={{fontSize: 10}}>{stageStyles[i.stato].nome}</span>
              </div>
              <div style={{fontSize: 12.5, fontWeight: 600, marginTop: 4}}>{i.titolo}</div>
            </div>
          ))}
        </div>

        <div className="ai-section">
          <div className="ai-title"><Icon name="flag" size={12}/> Tag automatici</div>
          <div className="flex gap-1" style={{flexWrap:"wrap"}}>
            {["mulino M3", "vibrazione", "martelli usurati", "ricambi", "P1"].map(t => (
              <span key={t} className="pill" style={{fontSize: 11, background:"var(--accent-soft)", color:"var(--accent-fg)", border:0}}>#{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.Chat = Chat;
