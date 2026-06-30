// Sample domain data for Frantum Service prototype
window.AppData = (() => {
  const clienti = [
    { id: "C-031", nome: "Acciai Riuniti Brescia", citta: "Brescia (BS)", impianti: 3, contratto: "Premium", tel: "+39 030 5512..." },
    { id: "C-018", nome: "Rottami Po S.p.A.", citta: "Cremona (CR)", impianti: 2, contratto: "Standard", tel: "+39 0372 3344..." },
    { id: "C-044", nome: "MetalRecuperi Veneto", citta: "Padova (PD)", impianti: 1, contratto: "Premium", tel: "+39 049 7788..." },
    { id: "C-022", nome: "Frantumati Adriatica", citta: "Ancona (AN)", impianti: 2, contratto: "Standard", tel: "+39 071 2245..." },
    { id: "C-009", nome: "Ferro Service Campania", citta: "Salerno (SA)", impianti: 4, contratto: "Premium", tel: "+39 089 9911..." },
    { id: "C-051", nome: "Siderurgica Sicula", citta: "Catania (CT)", impianti: 1, contratto: "Standard", tel: "+39 095 4422..." },
  ];

  const tecnici = [
    { id: "T-01", nome: "Marco Bianchi", ruolo: "Senior Tech",  iniziali: "MB", colore: "amber",  zona: "Nord-Ovest" },
    { id: "T-02", nome: "Luca Rossi",    ruolo: "Senior Tech",  iniziali: "LR", colore: "blue",   zona: "Nord-Est" },
    { id: "T-03", nome: "Sara Conti",    ruolo: "Tech",         iniziali: "SC", colore: "green",  zona: "Centro" },
    { id: "T-04", nome: "Davide Greco",  ruolo: "Tech",         iniziali: "DG", colore: "purple", zona: "Sud" },
    { id: "T-05", nome: "Ilaria Manzo",  ruolo: "Junior Tech",  iniziali: "IM", colore: "red",    zona: "Isole" },
  ];

  const interventi = [
    { id: "INT-2487", titolo: "Sostituzione martelli mulino M3", cliente: "Acciai Riuniti Brescia", impianto: "Mulino M3", stato: "nuovo", priorita: 1, tecnico: null, eta: "Oggi 14:30", canale: "WhatsApp" },
    { id: "INT-2486", titolo: "Allarme temperatura cuscinetti", cliente: "Rottami Po S.p.A.", impianto: "Frantoio F1", stato: "nuovo", priorita: 1, tecnico: null, eta: "Oggi 16:00", canale: "Telegram" },
    { id: "INT-2485", titolo: "Manutenzione programmata Q2", cliente: "MetalRecuperi Veneto", impianto: "Linea separazione L2", stato: "nuovo", priorita: 3, tecnico: null, eta: "Mer 12 mag", canale: "Email" },

    { id: "INT-2480", titolo: "Sostituzione griglia inferiore", cliente: "Ferro Service Campania", impianto: "Trituratore T2", stato: "pianificato", priorita: 2, tecnico: "T-04", eta: "Mar 11 mag, 09:00", canale: "Portale" },
    { id: "INT-2478", titolo: "Calibrazione separatore magnetico", cliente: "Frantumati Adriatica", impianto: "Sep. mag. S1", stato: "pianificato", priorita: 2, tecnico: "T-03", eta: "Mer 12 mag, 14:00", canale: "WhatsApp" },
    { id: "INT-2476", titolo: "Revisione impianto idraulico", cliente: "Acciai Riuniti Brescia", impianto: "Mulino M1", stato: "pianificato", priorita: 3, tecnico: "T-01", eta: "Gio 13 mag, 08:30", canale: "Portale" },

    { id: "INT-2470", titolo: "Riparazione nastro trasportatore", cliente: "Siderurgica Sicula", impianto: "Nastro N3", stato: "in_corso", priorita: 1, tecnico: "T-05", eta: "in corso da 09:15", canale: "Telegram" },
    { id: "INT-2469", titolo: "Sostituzione coltelli rotore", cliente: "Rottami Po S.p.A.", impianto: "Trituratore T1", stato: "in_corso", priorita: 2, tecnico: "T-02", eta: "in corso da 11:00", canale: "WhatsApp" },

    { id: "INT-2460", titolo: "Tarature sensori vibrazione", cliente: "MetalRecuperi Veneto", impianto: "Mulino M2", stato: "completato", priorita: 3, tecnico: "T-03", eta: "Compl. 06 mag", canale: "Portale" },
    { id: "INT-2458", titolo: "Pulizia ciclone aspirazione", cliente: "Acciai Riuniti Brescia", impianto: "Aspirazione A1", stato: "completato", priorita: 3, tecnico: "T-01", eta: "Compl. 05 mag", canale: "WhatsApp" },
    { id: "INT-2455", titolo: "Allineamento alberi motore", cliente: "Ferro Service Campania", impianto: "Frantoio F2", stato: "completato", priorita: 2, tecnico: "T-04", eta: "Compl. 04 mag", canale: "Portale" },

    { id: "INT-2440", titolo: "Sostituzione bobine inverter", cliente: "Frantumati Adriatica", impianto: "Quadro Q3", stato: "fatturato", priorita: 2, tecnico: "T-03", eta: "Fatt. 02 mag", canale: "Portale" },
    { id: "INT-2438", titolo: "Audit sicurezza annuale", cliente: "Siderurgica Sicula", impianto: "Tutto stabilimento", stato: "fatturato", priorita: 3, tecnico: "T-05", eta: "Fatt. 30 apr", canale: "Email" },
  ];

  const conversazioni = [
    {
      id: "CV-01", canale: "wa",
      contatto: "Giuseppe Marino",
      ruolo: "Capo turno · Acciai Riuniti Brescia",
      iniziali: "GM",
      anteprima: "Mulino M3 fermo, vibrazione anomala dai martelli...",
      ora: "14:02",
      nonLetti: 3,
      tag: ["urgente", "mulino M3"],
      urgenza: 0.86,
      tipo: "Guasto meccanico",
      cliente: "C-031",
      messaggi: [
        { da: "in", autore: "Giuseppe Marino", testo: "Buongiorno, abbiamo fermato M3. Vibrazione fortissima sui martelli da stamattina.", ora: "13:42" },
        { da: "in", autore: "Giuseppe Marino", testo: "Sembra che almeno 3 martelli siano usurati. Vi mando una foto.", ora: "13:43" },
        { da: "in", autore: "Giuseppe Marino", foto: "FOTO · martelli usurati M3", ora: "13:44" },
        { da: "out", autore: "Tu", testo: "Ricevuto Giuseppe. Apro subito un intervento P1, mando Marco Bianchi entro le 15:00.", ora: "13:51" },
        { da: "in", autore: "Giuseppe Marino", testo: "Perfetto, grazie. Quanti pezzi conviene sostituire?", ora: "13:58" },
        { da: "in", autore: "Giuseppe Marino", testo: "Mulino M3 fermo, vibrazione anomala dai martelli, ci servono pezzi anche per gli altri due.", ora: "14:02" },
      ],
    },
    {
      id: "CV-02", canale: "tg",
      contatto: "Anna Rizzo",
      ruolo: "Manutenzione · Rottami Po",
      iniziali: "AR",
      anteprima: "Allarme temperatura cuscinetti F1, salito a 78°C.",
      ora: "13:48",
      nonLetti: 2,
      tag: ["urgente", "temperatura"],
      urgenza: 0.78,
      tipo: "Allarme sensoristica",
      cliente: "C-018",
      messaggi: [
        { da: "in", autore: "Anna Rizzo", testo: "Allarme temperatura cuscinetti F1, salito a 78°C in 20 minuti.", ora: "13:30" },
        { da: "in", autore: "Anna Rizzo", testo: "Trend in salita, vi giro lo screenshot dello SCADA.", ora: "13:48" },
      ],
    },
    {
      id: "CV-03", canale: "wa",
      contatto: "Roberto Esposito",
      ruolo: "Direttore · Ferro Service Campania",
      iniziali: "RE",
      anteprima: "Confermo intervento di martedì alle 9:00.",
      ora: "12:30",
      nonLetti: 0,
      tag: ["pianificato"],
      urgenza: 0.18,
      tipo: "Conferma appuntamento",
      cliente: "C-009",
      messaggi: [
        { da: "out", autore: "Tu", testo: "Confermo Davide Greco martedì 11/05 ore 9:00 per griglia inferiore T2.", ora: "11:55" },
        { da: "in", autore: "Roberto Esposito", testo: "Confermo intervento di martedì alle 9:00.", ora: "12:30" },
      ],
    },
    {
      id: "CV-04", canale: "tg",
      contatto: "Stefano Greco",
      ruolo: "Resp. impianti · Siderurgica Sicula",
      iniziali: "SG",
      anteprima: "Foto post-intervento nastro N3, tutto ok.",
      ora: "11:08",
      nonLetti: 0,
      tag: ["chiuso"],
      urgenza: 0.05,
      tipo: "Aggiornamento intervento",
      cliente: "C-051",
      messaggi: [
        { da: "in", autore: "Stefano Greco", testo: "Ilaria ha finito, nastro riavviato, tutto ok.", ora: "11:05" },
        { da: "in", autore: "Stefano Greco", foto: "FOTO · nastro N3 dopo riparazione", ora: "11:08" },
      ],
    },
    {
      id: "CV-05", canale: "wa",
      contatto: "Carla Donati",
      ruolo: "Ufficio acquisti · MetalRecuperi",
      iniziali: "CD",
      anteprima: "Quando potete passare per la programmata Q2?",
      ora: "10:24",
      nonLetti: 1,
      tag: ["preventivo"],
      urgenza: 0.32,
      tipo: "Richiesta pianificazione",
      cliente: "C-044",
      messaggi: [
        { da: "in", autore: "Carla Donati", testo: "Quando potete passare per la programmata Q2 sulla L2?", ora: "10:24" },
      ],
    },
    {
      id: "CV-06", canale: "tg",
      contatto: "Paolo Vitale",
      ruolo: "Manutenzione · Frantumati Adriatica",
      iniziali: "PV",
      anteprima: "Ok per mercoledì pomeriggio. Saremo in 2 a riceverla.",
      ora: "Ieri",
      nonLetti: 0,
      tag: ["pianificato"],
      urgenza: 0.12,
      tipo: "Conferma appuntamento",
      cliente: "C-022",
      messaggi: [],
    },
    {
      id: "CV-07", canale: "wa",
      contatto: "Elena Russo",
      ruolo: "Acciai Riuniti Brescia",
      iniziali: "ER",
      anteprima: "Grazie del rapportino, tutto chiaro.",
      ora: "Ieri",
      nonLetti: 0,
      tag: ["chiuso"],
      urgenza: 0.04,
      tipo: "Conferma documento",
      cliente: "C-031",
      messaggi: [],
    },
  ];

  const notifiche = [
    { id: 1, tipo: "alert", icona: "alert", titolo: "Allarme temperatura cuscinetti F1", desc: "Rottami Po S.p.A. · soglia 78°C superata", ora: "2 min fa" },
    { id: 2, tipo: "chat", icona: "chat", titolo: "Nuovo messaggio da Giuseppe Marino", desc: "WhatsApp · Mulino M3 fermo, vibrazione...", ora: "8 min fa" },
    { id: 3, tipo: "info", icona: "tech", titolo: "Marco Bianchi ha iniziato l'intervento", desc: "INT-2469 · Sostituzione coltelli rotore T1", ora: "32 min fa" },
    { id: 4, tipo: "ok",   icona: "ok", titolo: "Intervento INT-2460 completato", desc: "Rapportino in attesa di firma cliente", ora: "1 h fa" },
    { id: 5, tipo: "info", icona: "doc", titolo: "Nuovo documento caricato", desc: "Foto post-intervento N3 · 8 file", ora: "2 h fa" },
    { id: 6, tipo: "warn", icona: "sla", titolo: "SLA a rischio: INT-2487", desc: "Risposta entro 30 min — restano 4 min", ora: "ora" },
  ];

  // gantt: blocchi posizionati per giorno (0-13)
  const gantt = [
    { tech: "T-01", blocks: [
      { day: 0, len: 1, label: "Ciclone A1 — Acciai Riuniti", color: "b-amber" },
      { day: 2, len: 2, label: "Revisione idraulica M1", color: "b-blue" },
      { day: 6, len: 1, label: "Audit annuale", color: "b-purple" },
      { day: 9, len: 1, label: "Mulino M3 — sostituzione martelli", color: "b-red" },
    ]},
    { tech: "T-02", blocks: [
      { day: 1, len: 1, label: "Trit. T1 — coltelli rotore", color: "b-amber" },
      { day: 3, len: 1, label: "Ispezione bobine inverter", color: "b-blue" },
      { day: 7, len: 2, label: "Manut. programmata Cremona", color: "b-green" },
    ]},
    { tech: "T-03", blocks: [
      { day: 0, len: 1, label: "Tarature sensori vibrazione", color: "b-green" },
      { day: 4, len: 1, label: "Calibrazione sep. magnetico", color: "b-blue" },
      { day: 8, len: 1, label: "Programmata Q2 — L2", color: "b-purple" },
      { day: 11, len: 1, label: "Ispezione quadro Q3", color: "b-amber" },
    ]},
    { tech: "T-04", blocks: [
      { day: 2, len: 1, label: "Griglia T2 — Salerno", color: "b-amber" },
      { day: 5, len: 2, label: "Allineamento alberi F2", color: "b-blue" },
      { day: 10, len: 1, label: "Sopralluogo cliente nuovo", color: "b-green" },
    ]},
    { tech: "T-05", blocks: [
      { day: 0, len: 1, label: "Nastro N3 — Catania", color: "b-red" },
      { day: 3, len: 1, label: "Audit annuale Sicula", color: "b-purple" },
      { day: 9, len: 2, label: "Ispezione siderurgica", color: "b-blue" },
    ]},
  ];

  // map pins (left%, top%)
  const cantieri = [
    { id: "C-031", x: 38, y: 22, label: "BS", stato: "alert", cliente: "Acciai Riuniti Brescia", attivi: 2 },
    { id: "C-018", x: 35, y: 26, label: "CR", stato: "alert", cliente: "Rottami Po S.p.A.", attivi: 1 },
    { id: "C-044", x: 47, y: 21, label: "PD", stato: "ok", cliente: "MetalRecuperi Veneto", attivi: 1 },
    { id: "C-022", x: 52, y: 38, label: "AN", stato: "ok", cliente: "Frantumati Adriatica", attivi: 1 },
    { id: "C-009", x: 56, y: 60, label: "SA", stato: "in_corso", cliente: "Ferro Service Campania", attivi: 3 },
    { id: "C-051", x: 56, y: 84, label: "CT", stato: "in_corso", cliente: "Siderurgica Sicula", attivi: 1 },
  ];

  const stages = [
    { key: "nuovo",       nome: "Nuovo",       count: 3, dot: "var(--blue)",   stripe: "var(--blue)" },
    { key: "pianificato", nome: "Pianificato", count: 3, dot: "var(--purple)", stripe: "var(--purple)" },
    { key: "in_corso",    nome: "In corso",    count: 2, dot: "var(--accent)", stripe: "var(--accent)" },
    { key: "completato",  nome: "Completato",  count: 3, dot: "var(--green)",  stripe: "var(--green)" },
    { key: "fatturato",   nome: "Fatturato",   count: 2, dot: "var(--text-3)", stripe: "var(--text-3)" },
  ];

  return { clienti, tecnici, interventi, conversazioni, notifiche, gantt, cantieri, stages };
})();
