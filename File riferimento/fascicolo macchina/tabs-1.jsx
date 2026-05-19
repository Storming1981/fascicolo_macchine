// Detail tabs: Anagrafica, Componenti
const T1_GROUPS = window.APP_DATA.COMPONENT_GROUPS;
const { EmptyVal: T1EmptyVal, PhotoPlaceholder: T1PhotoPlaceholder } = window.UI;

const TabAnagrafica = ({ machine }) => {
  return (
    <div className="tab-content">
      <div className="grid-two">
        <section className="card">
          <header className="card-header">
            <h3>Anagrafica macchina</h3>
          </header>
          <dl className="kv">
            <div><dt>ID Fascicolo</dt><dd className="mono">{machine.id}</dd></div>
            <div><dt>Job Number</dt><dd className="mono">{machine.job}</dd></div>
            <div><dt>Job Body</dt><dd className="mono">{machine.jobBody}</dd></div>
            <div><dt>Job Container</dt><dd className="mono">{machine.jobContainer}</dd></div>
            <div><dt>Modello</dt><dd>{machine.model}</dd></div>
            <div><dt>Anno</dt><dd>{machine.year}</dd></div>
          </dl>
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Cliente e destinazione</h3>
          </header>
          <dl className="kv">
            <div><dt>Cliente</dt><dd>{machine.customer}</dd></div>
            <div><dt>Paese</dt><dd>{machine.country}</dd></div>
            <div><dt>Sito</dt><dd>{machine.site}</dd></div>
            <div><dt>Data consegna</dt><dd>{machine.deliveryDate}</dd></div>
            <div><dt>Inizio produzione</dt><dd>{machine.productionStart}</dd></div>
          </dl>
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Targa tecnica</h3>
          </header>
          <dl className="kv">
            <div><dt>Peso</dt><dd>{machine.plate.weight}</dd></div>
            <div><dt>Potenza nominale</dt><dd>{machine.plate.power}</dd></div>
            <div><dt>Tensione / Frequenza</dt><dd>{machine.plate.voltage}</dd></div>
            <div><dt>Settaggi pressione</dt><dd className="mono">{machine.pressureSettings}</dd></div>
          </dl>
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Documenti allegati</h3>
            <button className="btn-ghost-sm"><FtIcon name="plus" size={14}/> Carica</button>
          </header>
          <ul className="doc-list">
            <li><FtIcon name="doc" size={16}/> <span>Disegno assemblaggio.pdf</span><span className="muted mono">2.4 MB</span></li>
            <li><FtIcon name="doc" size={16}/> <span>Schema elettrico_rev3.pdf</span><span className="muted mono">1.1 MB</span></li>
            <li><FtIcon name="doc" size={16}/> <span>Schema idraulico_rev2.pdf</span><span className="muted mono">820 KB</span></li>
            <li><FtIcon name="doc" size={16}/> <span>Manuale uso e manutenzione IT.pdf</span><span className="muted mono">8.7 MB</span></li>
            <li><FtIcon name="doc" size={16}/> <span>Dichiarazione di conformità CE.pdf</span><span className="muted mono">340 KB</span></li>
          </ul>
        </section>
      </div>
    </div>
  );
};

const TabComponenti = ({ machine, onIntervention }) => {
  const [openGroup, setOpenGroup] = React.useState('gearboxes');
  const groups = T1_GROUPS;
  return (
    <div className="tab-content">
      <div className="cmp-toolbar">
        <div className="cmp-summary">
          <span className="muted">Componenti tracciati:</span> <strong>{groups.length}</strong>
          <span className="dot-sep">·</span>
          <span className="muted">Matricole censite:</span> <strong>{groups.reduce((acc, g) => {
            const c = machine.components[g.id];
            if (!c) return acc;
            return acc + c.items.filter(i => i && i !== '—').length;
          }, 0)}</strong>
        </div>
        <div className="cmp-actions">
          <button className="btn-ghost-sm"><FtIcon name="download" size={14}/> Esporta CSV</button>
          <button className="btn-primary-sm" onClick={onIntervention}><FtIcon name="wrench" size={14}/> Sostituisci componente</button>
        </div>
      </div>

      <div className="cmp-list">
        {groups.map(group => {
          const c = machine.components[group.id];
          const filled = c?.items.filter(i => i && i !== '—').length || 0;
          const isOpen = openGroup === group.id;
          return (
            <div key={group.id} className={'cmp-row' + (isOpen ? ' open' : '')}>
              <button className="cmp-row-head" onClick={() => setOpenGroup(isOpen ? null : group.id)}>
                <span className="cmp-icon"><FtIcon name={group.icon} size={20}/></span>
                <div className="cmp-name">
                  <div className="cmp-label">{group.label}</div>
                  <div className="cmp-en mono muted">{group.en}</div>
                </div>
                <div className="cmp-brand"><EmptyVal value={c?.brand}/></div>
                <div className="cmp-count">
                  <span className={'cmp-count-pill' + (filled === group.slots.length ? ' full' : filled === 0 ? ' empty' : ' partial')}>
                    {filled} / {group.slots.length}
                  </span>
                </div>
                <FtIcon name={isOpen ? 'chev-down' : 'chev-right'} size={16}/>
              </button>
              {isOpen && (
                <div className="cmp-row-body">
                  <table className="cmp-table">
                    <thead><tr><th>Posizione</th><th>Matricola / S.N.</th><th>Foto</th><th>Note</th></tr></thead>
                    <tbody>
                      {group.slots.map((slot, i) => (
                        <tr key={i}>
                          <td>{slot}</td>
                          <td className="mono"><T1EmptyVal value={c?.items[i]}/></td>
                          <td>
                            {c?.items[i] && c.items[i] !== '—' ? (
                              <div className="thumb-cell">
                                <T1PhotoPlaceholder seed={(group.id.charCodeAt(0) + i*7 + machine.id.charCodeAt(2)) % 50} label={`${group.id.slice(0,3).toUpperCase()}-${i+1}`}/>
                              </div>
                            ) : <span className="muted">—</span>}
                          </td>
                          <td className="muted">{c?.items[i] && c.items[i] !== '—' ? '—' : 'Slot non occupato'}</td>
                        </tr>
                      ))}
                      {group.extra && c?.extra && Object.entries(group.extra).map(([key, label]) => (
                        <tr key={key} className="extra-row">
                          <td colSpan="2"><span className="muted">{label}</span></td>
                          <td colSpan="2" className="mono">{c.extra[key] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

window.TabAnagrafica = TabAnagrafica;
window.TabComponenti = TabComponenti;
