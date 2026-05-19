// Intervention modal: log a maintenance/replacement event with signature
const M_SignaturePad = window.UI.SignaturePad;

const InterventionModal = ({ machine, onClose, onSave }) => {
  const [phase, setPhase] = React.useState('maintenance');
  const [type, setType] = React.useState('replace');
  const [component, setComponent] = React.useState('hyd_pumps');
  const [slotIdx, setSlotIdx] = React.useState(0);
  const [oldSn, setOldSn] = React.useState('');
  const [newSn, setNewSn] = React.useState('');
  const [actor, setActor] = React.useState('D. Ferrari');
  const [pin, setPin] = React.useState('');
  const [signMethod, setSignMethod] = React.useState('canvas');
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const sigRef = React.useRef(null);

  const groups = window.APP_DATA.COMPONENT_GROUPS;
  const selectedGroup = groups.find(g => g.id === component);
  const cmp = machine.components[component];

  React.useEffect(() => {
    if (cmp && type === 'replace') {
      setOldSn(cmp.items[slotIdx] || '');
    }
  }, [component, slotIdx, type]);

  const handleSave = () => {
    if (!title) return;
    onSave({
      date: new Date().toISOString().slice(0, 10),
      phase,
      title,
      actor,
      note,
      sn: type === 'replace' ? `${oldSn} → ${newSn}` : null,
      signed: signMethod === 'pin' ? pin.length >= 4 : (sigRef.current && !sigRef.current.isEmpty()),
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Nuovo intervento</h2>
            <div className="muted small">Macchina <span className="mono">{machine.id}</span> · {machine.customer}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><FtIcon name="x" size={18}/></button>
        </header>

        <div className="modal-body">
          <div className="form-row">
            <label>Fase del ciclo vita</label>
            <div className="seg">
              {[
                { id: 'production', label: 'Produzione' },
                { id: 'testing', label: 'Collaudo' },
                { id: 'installed', label: 'Installazione' },
                { id: 'maintenance', label: 'Manutenzione' },
                { id: 'scrapped', label: 'Rottamazione' },
              ].map(o => (
                <button key={o.id} className={'seg-btn' + (phase === o.id ? ' active' : '')} onClick={() => setPhase(o.id)}>{o.label}</button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label>Tipo intervento</label>
            <div className="seg">
              {[
                { id: 'replace', label: 'Sostituzione componente' },
                { id: 'inspect', label: 'Ispezione / verifica' },
                { id: 'repair', label: 'Riparazione' },
                { id: 'note', label: 'Annotazione' },
              ].map(o => (
                <button key={o.id} className={'seg-btn' + (type === o.id ? ' active' : '')} onClick={() => setType(o.id)}>{o.label}</button>
              ))}
            </div>
          </div>

          {type === 'replace' && (
            <div className="form-grid">
              <div className="form-row">
                <label>Componente</label>
                <select className="input" value={component} onChange={e => { setComponent(e.target.value); setSlotIdx(0); }}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Posizione</label>
                <select className="input" value={slotIdx} onChange={e => setSlotIdx(+e.target.value)}>
                  {selectedGroup.slots.map((s, i) => <option key={i} value={i}>{s}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Matricola rimossa</label>
                <input className="input mono" value={oldSn} onChange={e => setOldSn(e.target.value)} placeholder="—"/>
              </div>
              <div className="form-row">
                <label>Matricola nuova</label>
                <input className="input mono" value={newSn} onChange={e => setNewSn(e.target.value)} placeholder="es. HYX222P00301"/>
              </div>
            </div>
          )}

          <div className="form-row">
            <label>Titolo intervento</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'replace' ? 'es. Sostituzione pompa idraulica P1' : 'Breve descrizione'}/>
          </div>

          <div className="form-row">
            <label>Note</label>
            <textarea className="input" rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="Cosa è stato fatto, perché, esiti, materiali utilizzati…"/>
          </div>

          <div className="form-row">
            <label>Allegati</label>
            <div className="attach-zone">
              <FtIcon name="camera" size={16}/>
              <span className="muted small">Trascina foto o clicca per allegare. Almeno una foto consigliata per sostituzione.</span>
            </div>
          </div>

          <div className="form-row">
            <label>Operatore</label>
            <input className="input" value={actor} onChange={e => setActor(e.target.value)}/>
          </div>

          <div className="form-row">
            <label>Firma digitale</label>
            <div className="seg">
              <button className={'seg-btn' + (signMethod === 'canvas' ? ' active' : '')} onClick={() => setSignMethod('canvas')}>
                <FtIcon name="sign" size={14}/> Penna
              </button>
              <button className={'seg-btn' + (signMethod === 'pin' ? ' active' : '')} onClick={() => setSignMethod('pin')}>
                <FtIcon name="pin" size={14}/> PIN + nome
              </button>
            </div>
            {signMethod === 'canvas' ? (
              <div>
                <M_SignaturePad ref={sigRef} height={140}/>
                <div className="sig-actions">
                  <button className="btn-ghost-sm" onClick={() => sigRef.current?.clear()}>Cancella</button>
                  <span className="muted small">Firmando dichiari di aver eseguito l'intervento conformemente alle procedure interne ZATO.</span>
                </div>
              </div>
            ) : (
              <div className="pin-row">
                <input className="input mono pin-input" type="password" maxLength="6" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="• • • •"/>
                <span className="muted small">PIN personale a 4–6 cifre</span>
              </div>
            )}
          </div>
        </div>

        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn-primary" onClick={handleSave} disabled={!title}>
            <FtIcon name="check" size={14}/> Registra intervento
          </button>
        </footer>
      </div>
    </div>
  );
};

const SignModal = ({ onClose, onConfirm, role }) => {
  const sigRef = React.useRef(null);
  const [method, setMethod] = React.useState('canvas');
  const [pin, setPin] = React.useState('');
  const [name, setName] = React.useState('');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Firma — {role}</h2>
            <div className="muted small">Verbale di collaudo</div>
          </div>
          <button className="icon-btn" onClick={onClose}><FtIcon name="x" size={18}/></button>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>Nome</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Cognome e nome"/>
          </div>
          <div className="form-row">
            <label>Metodo</label>
            <div className="seg">
              <button className={'seg-btn' + (method === 'canvas' ? ' active' : '')} onClick={() => setMethod('canvas')}>
                <FtIcon name="sign" size={14}/> Penna
              </button>
              <button className={'seg-btn' + (method === 'pin' ? ' active' : '')} onClick={() => setMethod('pin')}>
                <FtIcon name="pin" size={14}/> PIN
              </button>
            </div>
          </div>
          {method === 'canvas' ? (
            <div>
              <M_SignaturePad ref={sigRef} height={140}/>
              <div className="sig-actions">
                <button className="btn-ghost-sm" onClick={() => sigRef.current?.clear()}>Cancella</button>
              </div>
            </div>
          ) : (
            <div className="pin-row">
              <input className="input mono pin-input" type="password" maxLength="6" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="• • • •"/>
              <span className="muted small">PIN personale</span>
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn-primary" onClick={onConfirm}><FtIcon name="check" size={14}/> Conferma firma</button>
        </footer>
      </div>
    </div>
  );
};

window.InterventionModal = InterventionModal;
window.SignModal = SignModal;
