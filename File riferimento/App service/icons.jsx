// Icon set (stroke-based) for Frantum Service
const Icon = ({ name, size = 16, ...rest }) => {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    ticket: <><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M9 5v14"/></>,
    chat: <><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a4.5 4.5 0 0 1 5.5 4.4"/></>,
    map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></>,
    doc: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 19 6-6 4 4 3-3 4 4"/></>,
    bell: <><path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    filter: <><path d="M3 5h18l-7 9v6l-4-2v-4z"/></>,
    sort: <><path d="M7 4v16M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4"/></>,
    tools: <><path d="m14.7 6.3 3 3-9.4 9.4a2 2 0 1 1-3-3z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/><path d="M5 17l-2 4 4-2"/></>,
    flag: <><path d="M4 21V4"/><path d="M4 4h13l-2 4 2 4H4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <><path d="m5 12 5 5 9-11"/></>,
    arrowUp: <><path d="m6 14 6-6 6 6"/></>,
    arrowDown: <><path d="m6 10 6 6 6-6"/></>,
    sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></>,
    bot: <><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 14h.01M15 14h.01M2 14v2M22 14v2"/></>,
    pin: <><path d="M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></>,
    paperclip: <><path d="m21 11-9.6 9.6a5 5 0 0 1-7-7L13 4.4a3.5 3.5 0 1 1 5 5L9.4 18a2 2 0 1 1-2.8-2.8L15 7"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
    smile: <><circle cx="12" cy="12" r="9"/><path d="M9 14a3 3 0 0 0 6 0M9 9h.01M15 9h.01"/></>,
    send: <><path d="m4 12 17-8-7 17-3-7z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    phone: <><path d="M22 16.9V20a2 2 0 0 1-2.2 2A20 20 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7l.7 3.4a2 2 0 0 1-.6 2L7.6 10a16 16 0 0 0 6.4 6.4l1-1.5a2 2 0 0 1 2-.6l3.4.7A2 2 0 0 1 22 16.9z"/></>,
    sla: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    truck: <><path d="M3 7h11v10H3zM14 11h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></>,
    factory: <><path d="M3 21V11l5 3V8l5 3V8l5 3v10z"/><path d="M3 21h18M9 21v-4M14 21v-4"/></>,
    sign: <><path d="M3 17c4 0 4-6 8-6s4 6 8 6"/><path d="M3 21h18"/></>,
    wa: <path d="M12 2a10 10 0 0 0-8.6 15l-1.4 5 5-1.4A10 10 0 1 0 12 2zm5 14c-.2.5-1.2 1-1.7 1-.5 0-.5.4-3.3-.9-2.8-1.3-4.4-4.4-4.6-4.6-.1-.2-1-1.4-1-2.6s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.7 1.8.1.1.1.3 0 .5-.1.2-.2.3-.3.5-.2.2-.3.4-.5.5-.2.2-.3.3-.1.6.2.3.9 1.4 2 2.3 1.3 1.1 2.4 1.5 2.7 1.6.3.2.5.1.7-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.7-.1.3.1 1.7.8 2 1l.5.2c.1.2.1.7-.1 1.3z"/>,
    tg: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 7-1.6 7.5c-.1.5-.4.6-.8.4l-2.3-1.7-1.1 1.1c-.1.1-.2.2-.5.2l.2-2.5 4.5-4c.2-.2 0-.3-.3-.1l-5.5 3.5-2.4-.7c-.5-.2-.5-.5.1-.8l9.3-3.6c.4-.2.8.1.7.7z"/>,
    folder: <><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
    chevron: <><path d="m9 6 6 6-6 6"/></>,
    moon: <><path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z"/></>,
  };
  const isFilled = name === "wa" || name === "tg";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}
         fill={isFilled ? "currentColor" : "none"}
         stroke={isFilled ? "none" : "currentColor"}
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
         className="ico" {...rest}>
      {paths[name] || null}
    </svg>
  );
};

window.Icon = Icon;
