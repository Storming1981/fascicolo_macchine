// Shared UI primitives: StatusBadge, EmptyVal, ImagePlaceholder, SignaturePad

const StatusBadge = ({ status }) => {
  const meta = window.APP_DATA.STATUS_META[status] || { label: status, color: '#71717a', dot: '#a1a1aa' };
  return (
    <span className="badge">
      <span className="badge-dot" style={{ background: meta.dot }}></span>
      <span>{meta.label}</span>
    </span>
  );
};

const PhaseChip = ({ phase }) => {
  const meta = window.APP_DATA.PHASE_META[phase] || { label: phase, color: '#71717a' };
  return (
    <span className="phase-chip" style={{ background: meta.color + '1a', color: meta.color }}>
      {meta.label}
    </span>
  );
};

const EmptyVal = ({ value, fallback = '—' }) => {
  if (!value || value === '—') return <span className="muted">{fallback}</span>;
  return <span>{value}</span>;
};

// Pseudo-random visual placeholder for production photos. Looks like an industrial photo.
const PhotoPlaceholder = ({ seed = 0, label = '', tall = false, badge = null }) => {
  // generate a unique gradient + diagonal stripe pattern
  const hueA = (seed * 47) % 360;
  const hueB = (hueA + 30) % 360;
  const angle = (seed * 23) % 360;
  return (
    <div className={'photo-ph' + (tall ? ' photo-ph-tall' : '')}>
      <svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        <defs>
          <linearGradient id={`pg${seed}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hueA}, 8%, 22%)`}/>
            <stop offset="100%" stopColor={`hsl(${hueB}, 6%, 12%)`}/>
          </linearGradient>
          <pattern id={`pat${seed}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
            <rect width="6" height="6" fill="none"/>
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.04)" strokeWidth="2"/>
          </pattern>
        </defs>
        <rect width="100" height="70" fill={`url(#pg${seed})`}/>
        <rect width="100" height="70" fill={`url(#pat${seed})`}/>
        {/* rough silhouette of machinery */}
        <g opacity="0.18" fill="#fff">
          <rect x={10 + (seed%5)*3} y={30 - (seed%4)} width={55 + (seed%6)*2} height={25} rx="2"/>
          <circle cx={20 + (seed%4)*2} cy="58" r="6"/>
          <circle cx={55 + (seed%4)*2} cy="58" r="6"/>
          <rect x={68 + (seed%3)} y={20} width={20} height={10} rx="1"/>
        </g>
      </svg>
      <div className="photo-ph-overlay">
        <span className="mono">FOTO · {String(label || seed).padStart(3, '0')}</span>
        {badge && <span className="photo-badge">{badge}</span>}
      </div>
    </div>
  );
};

// Country flag tiny SVG, generic
const CountryDot = ({ code }) => {
  const colors = { DE: ['#000', '#dd0000', '#ffce00'], ES: ['#aa151b', '#f1bf00', '#aa151b'], IS: ['#02529c', '#fff', '#dc1e35'], SE: ['#006aa7', '#fecc00', '#006aa7'], FR: ['#0055a4', '#fff', '#ef4135'], US: ['#b22234', '#fff', '#3c3b6e'] };
  const c = colors[code] || ['#888', '#aaa', '#ccc'];
  return (
    <svg width="14" height="10" viewBox="0 0 6 4" style={{ borderRadius: 1, flexShrink: 0 }}>
      <rect width="2" height="4" fill={c[0]}/>
      <rect x="2" width="2" height="4" fill={c[1]}/>
      <rect x="4" width="2" height="4" fill={c[2]}/>
    </svg>
  );
};

// Signature pad — canvas-based, returns dataURL
const SignaturePad = React.forwardRef(({ height = 140 }, ref) => {
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);
  const lastRef = React.useRef(null);
  const [hasInk, setHasInk] = React.useState(false);

  React.useImperativeHandle(ref, () => ({
    clear: () => {
      const c = canvasRef.current;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      setHasInk(false);
    },
    isEmpty: () => !hasInk,
    toDataURL: () => canvasRef.current?.toDataURL('image/png'),
  }));

  React.useEffect(() => {
    const c = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
  }, []);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const t = e.touches?.[0];
    const cx = (t ? t.clientX : e.clientX) - r.left;
    const cy = (t ? t.clientY : e.clientY) - r.top;
    return { x: cx, y: cy };
  };

  const start = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    if (!hasInk) setHasInk(true);
  };
  const end = () => { drawingRef.current = false; };

  return (
    <div className="sig-wrap" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="sig-canvas"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      {!hasInk && <div className="sig-hint">Firma qui</div>}
    </div>
  );
});

// QR code — fake but plausible looking, deterministic from seed string
const FakeQR = ({ value = 'M-2026', size = 220 }) => {
  // 25x25 grid pseudo-random
  const N = 25;
  const cells = React.useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    const arr = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // finder patterns at 3 corners
        const inFinder = (
          (x < 7 && y < 7) ||
          (x >= N-7 && y < 7) ||
          (x < 7 && y >= N-7)
        );
        if (inFinder) {
          const lx = x < 7 ? x : (x - (N-7));
          const ly = y < 7 ? y : (y - (N-7));
          const ring = (lx === 0 || lx === 6 || ly === 0 || ly === 6);
          const inner = (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
          arr.push(ring || inner ? 1 : 0);
          continue;
        }
        h = (h * 1103515245 + 12345) >>> 0;
        arr.push(((h >>> 16) & 1));
      }
    }
    return arr;
  }, [value]);
  const cell = size / N;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ background: '#fff', borderRadius: 6 }}>
      {cells.map((v, i) => v ? (
        <rect key={i} x={(i % N) * cell} y={Math.floor(i / N) * cell} width={cell} height={cell} fill="#0f172a" />
      ) : null)}
    </svg>
  );
};

window.UI = { StatusBadge, PhaseChip, EmptyVal, PhotoPlaceholder, CountryDot, SignaturePad, FakeQR };
