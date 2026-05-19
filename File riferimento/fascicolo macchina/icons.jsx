// Inline SVG icons - line style, 20px stroke 1.6
const FtIcon = ({ name, size = 18, stroke = 1.6, color = 'currentColor' }) => {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (name) {
    case 'gear':
      return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>;
    case 'rotor':
      return <svg {...props}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>;
    case 'pump':
      return <svg {...props}><rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M8 9V5h8v4M12 13v4M9 13h6"/></svg>;
    case 'boost':
      return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8l4 4-4 4"/></svg>;
    case 'bolt':
      return <svg {...props}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
    case 'engine':
      return <svg {...props}><path d="M3 10h2V8h3V6h6v2h3v2h2v8H3z"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/></svg>;
    case 'box':
      return <svg {...props}><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>;
    case 'snow':
      return <svg {...props}><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/></svg>;
    case 'oil':
      return <svg {...props}><path d="M12 2c-3 4-6 7-6 11a6 6 0 0 0 12 0c0-4-3-7-6-11z"/></svg>;
    case 'drop':
      return <svg {...props}><path d="M12 3c-3 4-6 7-6 11a6 6 0 0 0 12 0c0-4-3-7-6-11z"/></svg>;
    case 'panel':
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18M7 13h2M7 17h2M13 13h4M13 17h4"/></svg>;
    case 'screen':
      return <svg {...props}><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/></svg>;
    case 'fan':
      return <svg {...props}><circle cx="12" cy="12" r="2"/><path d="M12 10c0-3 1.5-5 4-5s2 4 0 5-4 0-4 0M12 14c0 3-1.5 5-4 5s-2-4 0-5 4 0 4 0M10 12c-3 0-5-1.5-5-4s4-2 5 0 0 4 0 4M14 12c3 0 5 1.5 5 4s-4 2-5 0 0-4 0-4"/></svg>;
    case 'remote':
      return <svg {...props}><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M9 6h6M11 10h2M9 14h2M13 14h2M9 17h2M13 17h2"/></svg>;
    case 'blade':
      return <svg {...props}><path d="M3 21l8-8M11 13l5-5a3 3 0 1 1 4 4l-5 5M14 10l4 4M5 19l-2 2 2-2z"/></svg>;
    case 'home':
      return <svg {...props}><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11z"/></svg>;
    case 'machines':
      return <svg {...props}><rect x="3" y="9" width="18" height="11" rx="1"/><path d="M7 9V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4M9 13h6M9 16h4"/></svg>;
    case 'wrench':
      return <svg {...props}><path d="M14 6a4 4 0 1 0-1.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7-7A4 4 0 0 0 18 5l-2 2-1-1z"/></svg>;
    case 'people':
      return <svg {...props}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 2-4 5-4s4 1 4 3"/></svg>;
    case 'doc':
      return <svg {...props}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></svg>;
    case 'check':
      return <svg {...props}><path d="M5 12l5 5L20 7"/></svg>;
    case 'plus':
      return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'x':
      return <svg {...props}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'search':
      return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/></svg>;
    case 'filter':
      return <svg {...props}><path d="M3 5h18M6 12h12M10 19h4"/></svg>;
    case 'qr':
      return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="0.5"/><rect x="14" y="3" width="7" height="7" rx="0.5"/><rect x="3" y="14" width="7" height="7" rx="0.5"/><path d="M14 14h3v3M20 14v3M14 20h3M20 20h1"/></svg>;
    case 'image':
      return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/></svg>;
    case 'sign':
      return <svg {...props}><path d="M3 21h18M5 17l7-12 4 7-7 12-4-1zM12 5l3-2 3 2-3 2z"/></svg>;
    case 'clock':
      return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'arrow-left':
      return <svg {...props}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
    case 'arrow-right':
      return <svg {...props}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
    case 'chev-down':
      return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case 'chev-right':
      return <svg {...props}><path d="M9 6l6 6-6 6"/></svg>;
    case 'pin':
      return <svg {...props}><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>;
    case 'pkg':
      return <svg {...props}><path d="M21 7l-9 5-9-5M12 12v10M3 7v10l9 5 9-5V7l-9-5z"/></svg>;
    case 'truck':
      return <svg {...props}><rect x="2" y="7" width="12" height="9" rx="1"/><path d="M14 10h4l3 3v3h-7M6 19a2 2 0 1 0 4 0M16 19a2 2 0 1 0 4 0"/></svg>;
    case 'flag':
      return <svg {...props}><path d="M5 3v18M5 4h13l-3 4 3 4H5"/></svg>;
    case 'trash':
      return <svg {...props}><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v7M14 11v7"/></svg>;
    case 'download':
      return <svg {...props}><path d="M12 3v13M6 12l6 5 6-5M4 21h16"/></svg>;
    case 'sun':
      return <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>;
    case 'bell':
      return <svg {...props}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>;
    case 'camera':
      return <svg {...props}><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="8"/></svg>;
  }
};

window.FtIcon = FtIcon;
