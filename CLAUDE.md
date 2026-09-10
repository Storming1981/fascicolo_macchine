# Fascicolo Tecnico Macchina — ZATO

App che funge da **fascicolo tecnico / diario di vita** di ogni macchina o impianto
prodotto da ZATO: dalla genesi (produzione) fino alla rottamazione.

## Obiettivo funzionale (dal committente)

- Tracciare la **produzione** con tutti i componenti, le **matricole/seriali** e le **foto** di produzione.
- Registrare **chi ha fatto montaggio e collaudo** con **firme digitali** (login + PIN/firma a penna).
- Essere il **diario della macchina**: ogni sostituzione pezzo o intervento va annotato.
- **Import massivo** macchine da Excel/CSV (formato `FILE MATRICOLE`).
- Etichetta/QR per accedere al fascicolo dal campo.
- **Responsive**: usabile da smartphone e tablet (officina/campo).
- Linea grafica: brand **ZATO** (blu navy, pulito) coerente con la dashboard aziendale.

## Decisioni concordate con l'utente

| Tema | Scelta |
|------|--------|
| Accesso / firme | Login email+password per entrare; firma intervento via **PIN personale** o **firma a penna** su canvas |
| Dati iniziali | Solo **poche macchine di esempio** + funzione **Import Excel/CSV** per caricamento massivo |
| Storage file | **Disco locale del server** (`/uploads`), riferimenti nel DB |
| Database | PostgreSQL locale: `postgresql://postgres:1234@localhost:5433/fasciolo_macchine` |

## Stack tecnico

- **Next.js 15** (App Router) + **TypeScript** + **React 18**
- **Prisma** ORM su **PostgreSQL**
- Auth custom: cookie di sessione firmato (`jose`), password con `bcryptjs`
- `xlsx` per import, `qrcode` per etichette
- CSS globale ritematizzato sulla **dashboard aziendale ZATO** (sales dashboard):
  sidebar bianca con nav raggruppata, accento blu `#2f6aed`, titoli navy
  `#15324f`, sfondo `#f4f6f9`, topbar con ricerca + saluto + avatar/notifiche/
  impostazioni, stat-card con icona colorata e valore in grande, font Inter.

## Modello dati (Prisma)

- `User` — operatori: nome, email, password hash, ruolo, PIN hash, attivo
- `Machine` — fascicolo: id leggibile (M-AAAA-NNNN), **tipologia impianto**,
  job/jobBody/jobContainer, modello, anno, cliente, paese, sito, stato,
  avanzamento, date, targa tecnica, settaggi pressione

### Tipologia impianto e modelli (`src/lib/plant.ts`)

- Tipologie: BLUE DEVIL, BLUE SHARK, BLUE SORTER, BLUE MARLIN, BLUE STORM, CESOIE, SPACCABINARI.
- Modelli per tipologia:
  - BLUE DEVIL → CONTAINER ELETTRICO, CONTAINER DIESEL, CORPO TRITURATORE
  - BLUE SHARK → MULINO 12-10, MULINO 16-13
  - BLUE SORTER → LINEA DI SEPARAZIONE SCL-20
  - CESOIE → CAYMAN 06/10/20/30/40/50/70/90
  - SPACCABINARI → CAYMAN RB20, CAYMAN RB40
  - BLUE MARLIN / BLUE STORM → solo "Altro / Personalizzato" (modelli da definire)
- **Job Number = commessa di vendita.** Un **BLUE DEVIL** si compone di un
  CORPO TRITURATORE (`jobBody`) e di un CONTAINER (`jobContainer`): per le
  macchine importate questi sono numeri di commessa, per le future saranno
  numeri di ordine di produzione.

### Integrazione gestionale ZATO (ERP — SQL Server, read-only)

- **Server**: `SQLSERVER_*` in `.env` (host 192.168.1.144:1433, DB `ZATO`).
  Gestionale **Zucchetti AdHoc Revolution** (nomi tabella criptici, colonne con
  prefisso es. `co_`, `an_`, `lce_`; multi-azienda via `codditt='ZATO'`).
- **Chiave di join: il Job Number del fascicolo == `commess.co_comme` (intero).**
  NON è `co_descr1` (lì c'è la descrizione tipo "BLUE DEVIL GF4000RII E #014").
- Mappatura (vedi `src/lib/erp.ts` e `scripts/erp-*.ts`):
  - Cliente = `anagra.an_descr1` via `commess.co_conto = anagra.an_conto` (`an_tipo='C'`)
  - Apertura/chiusura commessa = `commess.co_dtaper` / `co_dtchiu` (+ flag `co_chiusa`);
    date sentinella 1900/2099 → trattate come null
  - **Inizio produzione = `MIN(avlavp.lce_start)`**, **Fine = `MAX(avlavp.lce_stop)`**
    dove `avlavp.lce_commeca = co_comme` (avlavp = avanzamento lavorazioni/timbrature)
  - Fasi/centri di lavoro = `avlavp` (`lce_desart/deslavo/descent/flfinale`)
  - Ordini = `testord.td_commeca` / `movord.mo_commeca`; DDT/spedizione = `testmag.tm_commeca`
- Copertura attuale flotta: **223/249 job** trovati in `commess`, **50** con
  timbrature in `avlavp`. I 26 mancanti sono job in formato libero/storici
  ("ordine 72", "144 / 12", ...).
- **Paese cliente**: `anagra.an_stato` è il codice targa (D, S, TR, RCH…); va
  mappato via `tabstat` (`tb_codstat → tb_siglaiso` ISO2 + `tb_desstat` nome) e
  poi passato a `resolveCountry()` (riusa l'anagrafica paesi/bandiere). Il sync
  aggiorna il paese solo se il codice è riconosciuto (no "XX").
- **Impianti nuovi / ordini di produzione**: i corpi e i container nuovi NON
  hanno commessa dedicata → stanno tutti sotto la commessa generica
  **999999999**; ognuno fa riferimento a un **ordine di produzione** in `avlavp`,
  identificato dalla tupla `lce_ortipo='H'` / `lce_oranno` / `lce_orserie` /
  `lce_ornum` (intestazione in `testord` con `td_tipork='H'`). L'utente mette la
  commessa in jobBody/jobContainer (es. 999999999) e poi **seleziona l'ordine**
  dalla tendina; ore/date/articoli si calcolano sull'ORDINE, non sulla commessa
  generica (che aggregherebbe macchine diverse — per questo `getJobData` non
  calcola l'aggregato per 999999999). `erp.ts`: `getCommessaOrders(commessa)`
  (lista ordini con articolo principale = max ore), `getOrderData(key)` (ore,
  date, articoli con `lce_codart`/`lce_desart`), chiavi via `buildOrderKey`/
  `parseOrderKey`. Campi `Machine`: `erpBodyOrder`, `erpContainerOrder`
  ("tipork|anno|serie|numero"). API: `GET /api/erp/commessa/[commeca]/orders`.
  UI: tendina **Ordine Corpo / Ordine Container** nella card ERP + tabella
  articoli per ordine selezionato.
- **API**: `GET /api/erp/job/[job]` (dati commessa, `?fasi=1` per il dettaglio
  timbrature); `GET|POST /api/machines/[id]/erp-sync` (anteprima / sync completo
  singola macchina); `POST /api/erp/sync-all` (batch, permesso `machine.import`).
- **Sync** (`src/lib/erpSync.ts`): `syncMachine(id)` / `syncAllMachines()` scrivono
  nel fascicolo cliente+paese, `erpDescription` (co_descr1), `erpHours` (ore
  timbrate), `productionStart` e le `MachineMilestone` inizio/fine produzione
  (`source=GESTIONALE`); i campi assenti nel gestionale non vengono toccati.
  Nuovi campi su `Machine`: `erpDescription`, `erpHours`, `erpSyncedAt`.
- **UI**: card **"Dati gestionale (ERP)"** nella scheda Anagrafica (auto-refresh
  al cambio job, una riga per commessa Vendita/Corpo/Container, colonna Ore,
  bottone *Applica date*) + scheda **"Gestionale (ERP)"** in Impostazioni con
  *Sincronizza tutti i fascicoli*. CLI dev: `npm run erp:sync`.
- Driver: `mssql` (pool singleton in `src/lib/erp.ts`, riuso in dev via globalThis).
- **Stato**: sync batch eseguito → 170/188 fascicoli aggiornati, 50 con date di
  produzione+ore. Non esiste ancora un sync **schedulato** (per la pubblicazione
  web): `syncAllMachines()` è già pronto da agganciare a un cron/agent.

### Sviluppi futuri (richiesti dal committente)

- Selezione dell'**ordine di riferimento** che compone la commessa di vendita
  da un elenco di ordini imputati a ZATO (sostituirà l'inserimento manuale di
  jobBody/jobContainer). Predisporre integrazione con l'anagrafica ordini ZATO
  (tabelle `testord`/`movord` già individuate).
- `Component` — gruppo componente per macchina (riduttori, motori, pompe, ...)
- `ComponentItem` — singolo slot/posizione con matricola, brand, note
- `DiaryEvent` — evento del diario (produzione/collaudo/spedizione/installazione/manutenzione/rottamazione)
- `Signature` — firma digitale collegata a evento/collaudo (operatore, metodo, immagine, hash)
- `Photo` — foto di produzione/intervento (path su disco, categoria, autore)
- `Document` — documenti allegati (PDF schemi, manuali, dichiarazioni CE)
- `Setting` — configurazione runtime (key/value Json): `plantConfig` (tipologie
  e modelli editabili) e `permissions` (matrice permessi per ruolo)
- `MachineMilestone` — date di cambio stato (key/date/source). Per ora inserite
  a mano; future fonti gestionale: produzione inizio/fine = prima/ultima
  timbratura, collaudo = ordini di produzione, spedita = DDT, installata/
  esercizio/dismessa = manuale. Card editabile in Anagrafica + voci nel diario.

### Impostazioni & Permessi

- Pagina **/impostazioni** (voce menu visibile solo a chi ha `settings.manage`;
  ADMIN sempre): due schede —
  - **Tipologie & Modelli**: CRUD tipologie impianto e relativi modelli
    (salvati in `Setting.plantConfig`); alimentano il wizard "Nuova macchina".
    Default da `src/lib/plant.ts` se non personalizzato.
  - **Permessi per ruolo**: matrice ruolo × azione
    (`machine.create/edit/intervention/sign/import`, `users.manage`,
    `settings.manage`). ADMIN ha sempre tutto e non è modificabile.
- Default in `src/lib/permissions.ts`; merge con DB in `src/lib/settings.ts`.
- Enforcement **server-side** in tutte le API (`userCan`) + gating UI
  (nav, pulsanti Nuova macchina / Import / Nuovo intervento / Firma / stato)
  via `src/lib/caps.ts`. Le pagine protette redirigono se non autorizzati.
- **Anagrafica paesi estesa** (`src/lib/domain.ts`, `COUNTRY_DB`): ~45 paesi con
  codice ISO2, etichetta IT, colori bandiera e alias EN; `prisma/backfill-country.ts`
  rimappa i fascicoli esistenti (nessun codice `XX` residuo → bandiere a colori).
- Tipologia impianto **dedotta** per i 187 fascicoli importati → tutti
  `BLUE DEVIL` (dati MATRICOLE = trituratori); 181 con modello "Da definire"
  impostati a `CORPO TRITURATORE`. Script: `prisma/backfill-plant.ts`.

## ZATO Brain — Knowledge & assistente AI

Il "cervellone" aziendale: risponde a domande di assistenza citando la
documentazione ZATO, sia agli operatori interni sia ai clienti dal portale.

### Principio guida: il documento si legge una volta sola

L'estrazione del testo avviene **all'ingestione**, non a ogni domanda. Un manuale
da 300 pagine (~400k token) non viene mai rispedito al modello: a runtime partono
solo i ~12 frammenti pertinenti (~5k token). Da qui tutte le scelte sotto.

### Pipeline (`src/lib/brain/`)

| File | Ruolo |
|------|-------|
| `config.ts` | Modelli, parametri di indicizzazione/retrieval, stima costi |
| `client.ts` | Client Anthropic condiviso (SDK ufficiale), errori leggibili |
| `extract.ts` | PDF (pdfjs, righe ricostruite dalle coordinate), DOCX (mammoth via HTML per tenere i titoli), testo, immagini |
| `chunk.ts` | Chunk ~450 token con breadcrumb `Manuale › Sezione › p. 42` |
| `indexer.ts` | Scrittura chunk + `tsvector` italiano; idempotente via `contentHash` |
| `glossary.ts` | **Dizionario ZATO**: gergo di cantiere → termine del manuale |
| `retrieve.ts` | Espansione query (Haiku) + full-text + boost + dedup per fonte |
| `ask.ts` | System prompt in **prompt cache**, documenti con **Citations API**, streaming |
| `corpus.ts` | Rapportini, chat, diari e articoli resi cercabili come i manuali |

### Due modelli, due ruoli

- **Risposte**: `claude-opus-5` (`BRAIN_ANSWER_MODEL`), thinking adattivo, effort medium.
- **Lavoro ausiliario**: `claude-haiku-4-5` (`BRAIN_UTILITY_MODEL`) per espansione
  query, OCR delle pagine scansionate, descrizione dei disegni tecnici.

Il system prompt (regole + dizionario intero) è stabile e va in `cache_control`:
si paga pieno una volta, poi al 10%. Per questo il dizionario può essere generoso.

### Come vengono trattati i formati

- **PDF nativi** → testo estratto per pagina, righe ricostruite (i manuali a due
  colonne altrimenti escono a insalata e il retrieval peggiora).
- **PDF scansionati** (la norma per i manuali ZATO: il GF4000 ha 105 pagine e
  516 caratteri di testo estraibile in tutto) → le sole pagine senza testo
  vengono **ritagliate con pdf-lib in un PDF a sé** e mandate a Claude a blocchi
  di 5. Il ritaglio non è un'ottimizzazione: mandando il manuale intero si supera
  il limite di 100 pagine per documento dell'API e ogni chiamata fallisce.
  Tetto di 200 pagine (`BRAIN_OCR_MAX_PAGES`), sotto l'euro a manuale.
- **Word** → solo `.docx` (mammoth). Il `.doc` va convertito.
- **Disegni tecnici e foto** → descritti **una volta** da Claude e indicizzati come
  testo cercabile: a runtime la ricerca lavora su testo, l'immagine non viene
  più rispedita al modello.
- **Video** → il filmato non passa mai dal modello. Si indicizzano titolo e
  capitoli con timestamp (`02:15 Sezionamento`): il Brain propone il video già
  posizionato sul minuto giusto.

### Retrieval

1. Il **dizionario** espande la domanda (gratuito, deterministico).
2. Haiku produce 2-4 riformulazioni con il lessico dei manuali.
3. Full-text Postgres (`websearch_to_tsquery`, italiano) su tutte le query;
   se la passata in AND è a vuoto si ripiega su una passata in **OR** (senza,
   "collaudo BLUE DEVIL" non restituirebbe nulla).
4. Boost: tipo fonte (manuale > chat), match tipologia/modello/fascicolo,
   decadimento per età sui contenuti operativi.
5. Massimo 3 frammenti per fonte → meglio quattro documenti diversi che quattro
   pagine consecutive dello stesso manuale.

### L'indicizzazione non sta nella richiesta HTTP

Un manuale scansionato richiede ~10 minuti di OCR: qualunque proxy chiude prima.
L'upload salva il file, risponde in un secondo e prosegue con `after()`; la
sorgente resta in `PROCESSING` e la scheda Documenti si aggiorna da sola ogni 5
secondi. Prima l'utente vedeva un **504 mentre il lavoro finiva bene**, che è il
modo peggiore di sbagliare: si rischia di ricaricare lo stesso file.

Se il container viene riavviato a metà lavoro la sorgente resta in `PROCESSING`:
si recupera con `npm run brain:pending`.

### Corpus vivo (il feedback loop chiesto dal committente)

`syncCorpus()` rende cercabili **rapportini** (lavorazioni, problematiche,
ricambi), **chat di cantiere**, **diario macchina** e **articoli**. Ogni contenuto
derivato è una `KnowledgeSource` con chiave `(originKind, originId)`: la
sincronizzazione è idempotente. Restano sempre `visibility = INTERNAL`, quindi
non raggiungono mai il portale cliente.

Il **feedback** sulle risposte (`BrainMessage.rating`) non riaddestra nulla: serve
a far emergere le domande a cui la knowledge base non sa rispondere — cioè la
lista dei documenti da caricare.

### Sicurezza dei dati

- `KnowledgeVisibility`: `INTERNAL` (solo ZATO) o `CUSTOMER` (anche portale).
- Nel portale il retrieval filtra a `CUSTOMER` **e** scarta le fonti riservate ad
  altri clienti; il system prompt cambia tono e vieta dati interni.
- Permesso nuovo `knowledge.ask` (interrogare il Brain); `knowledge.manage`
  governa caricamento documenti, dizionario e sync del corpus.

### UI

- **/knowledge** a schede: *Chiedi al Brain* · *Documenti* · *Dizionario* ·
  *Articoli* · *Problematiche*. Componente chat: `src/components/BrainChat.tsx`
  (streaming SSE, fonti espandibili, allegato foto, voto utile/non utile, costo
  stimato). Stili in `src/app/brain.css`.
- **/portale**: scheda *Assistenza tecnica* accanto agli interventi, stesso
  componente con `variant="portal"` (niente allegati, niente diagnostica interna).

### Operatività

```
npm run brain:seed      # dizionario di partenza (43 voci del gergo ZATO)
npm run brain:sync      # reindicizza il corpus operativo — da mettere a cron notturno
npm run brain:pending   # riprova i documenti rimasti in coda o falliti
```

`ANTHROPIC_API_KEY` in `.env`. **Senza chiave l'app funziona lo stesso**: la
scheda Brain mostra un avviso, l'indicizzazione dei documenti testuali continua
a funzionare, si perdono solo OCR, descrizione immagini ed espansione query.

### Trappole già pagate (non ripeterle)

- **Il worker di pdfjs non finisce nel build standalone.** pdfjs in Node carica
  un "fake worker" con un import costruito a runtime: il tracer di Next non lo
  vede e nell'immagine resta il solo `pdf.mjs`. Il `Dockerfile` copia a mano
  `pdf.worker.mjs` (2,3 MB). In locale non si vede: lì `node_modules` è completo.
- **`server-only` rompe gli script CLI.** tsx lo risolve in CJS e il pacchetto
  lancia. I moduli `brain/` usati da `brain:sync` non lo importano; resta solo
  in `ask.ts`, che gira unicamente dalle route.
- **Il proxy ha bisogno di un `location /api/` suo** (timeout 600s, buffering
  off, 64m) — vedi `DEPLOY.md`.

Stato in produzione: manuale GF4000 indicizzato (105 pagine scansionate → 346
frammenti, 177k caratteri via OCR), più il corpus operativo (190 diari, 11
rapportini, 3 articoli, chat) e 43 termini a dizionario.

## Struttura cartelle

```
/ (root progetto)
  prisma/schema.prisma        schema DB
  prisma/seed.ts              utente admin + macchine esempio
  src/app/                    pagine App Router
  src/app/api/                API routes
  src/lib/                    db, auth, dominio, costanti componenti
  src/lib/brain/              ZATO Brain: estrazione, chunking, indice, retrieval, risposta
  src/components/             componenti UI
  public/                     logo ZATO, asset
  uploads/                    file caricati (foto, firme, documenti) — non versionato
  File riferimento/           materiale fornito dal committente (prototipo, logo, Excel)
```

## Stato avanzamento

- [x] Analisi prototipo + Excel MATRICOLE + design ZATO
- [x] Documento di tracciamento (questo file)
- [x] Scaffold progetto Next.js 16 + dipendenze (React 19, Prisma 6)
- [x] Schema Prisma + push su DB locale
- [x] Auth (login email/password + sessione JWT cookie + firma PIN / penna)
- [x] Design system ZATO (globals.css blu navy + logo + icone, responsive)
- [x] Pagine UI (dashboard, macchine, dettaglio a tab, wizard nuova macchina, persone, import)
- [x] API (macchine, stato, intervento, firma, upload foto/documenti, import, utenti)
- [x] Import Excel/CSV (formato MATRICOLE) + seed 6 macchine esempio + 7 utenti
- [x] Build di produzione verde + smoke test end-to-end
- [x] ZATO Brain: knowledge indicizzata (PDF/Word/immagini/video) + assistente AI con citazioni, interno e su portale cliente

## Funzionalità implementate

- **Login**: `admin@zato.it` / `zato2026` (tutti gli utenti seed: password `zato2026`).
  PIN firma: admin `0000`, m.rossi `1111`, a.verdi `2222`, p.costa `3333`,
  g.marini `4444`, f.greco `5555`, d.ferrari `6666`.
- **Dashboard**: KPI flotta, pipeline per stato, attività recenti.
- **Macchine**: ricerca + filtri di stato; tabella responsive.
- **Dettaglio macchina** (6 tab): Anagrafica + documenti, Componenti & Matricole
  (accordion con sostituzione pezzo e foto per slot), Foto produzione (upload con
  categorie), Collaudo & Firme (firme per ruolo PIN/penna), Diario macchina
  (timeline genesi→rottamazione), QR & Etichetta (QR generato + stampa).
- **Stato/avanzamento** modificabili dal dettaglio (slider + select), evento a diario.
- **Nuovo intervento**: fase, tipo (sostituzione/ispezione/riparazione/nota),
  matricole, foto, firma PIN o a penna su canvas → diario + firma + aggiorna seriale.
- **Nuova macchina**: wizard 4 step (identificazione, cliente, targa, componenti).
  Il **cliente si sceglie dall'anagrafica** con tendina ricercabile
  (`src/components/CustomerPicker.tsx` → `/api/customers/search`), non a mano:
  il fascicolo salva `Machine.customerId` e compare così tra le macchine del
  cliente negli interventi di service. Chi ha `customer.manage` può creare al
  volo la scheda cliente dal wizard. `createMachine()` aggancia comunque il
  Customer per nome (case-insensitive) quando `customerId` non è passato —
  utile per l'import massivo.
- **Modifica anagrafica fascicolo**: nella scheda Anagrafica il pulsante
  *Modifica* (permesso `machine.edit`) rende editabili tipologia, modello,
  anno, job/jobBody/jobContainer, cliente (tendina anagrafica), paese, sito,
  date e targa tecnica. `PATCH /api/machines/[id]` valida i campi e **annota a
  diario** le variazioni ("Anagrafica fascicolo aggiornata: campo vecchio → nuovo").
- **Import Excel/CSV**: anteprima (dry-run) + conferma; salta job già presenti.
- **Persone**: elenco operatori, firme, creazione operatore (solo ADMIN).
- **Ricerca topbar intelligente** (`/api/search`): matricola componente / codice
  fascicolo / job → apre direttamente la macchina; testo generico → lista filtrata.
- **P.O.S. — Piano Operativo di Sicurezza (vincolo di pianificazione)**:
  ogni intervento nasce nello stato **DOCUMENTAZIONE** ("Documentazione da
  validare"). Finché il P.O.S. non è **caricato** (file Word/PDF compilato a
  mano con intestazione cliente, `InterventoDocument.category = "pos"`, uno solo
  per intervento) **e validato** dal responsabile (flag di presa visione +
  firma a penna o PIN), l'intervento **non si assegna e non si pianifica**;
  poi passa automaticamente a NUOVO ed entra nel flusso normale. Gli altri
  documenti restano liberi (upload a mano, nessun vincolo).
  - Responsabile abilitato: flag **`User.posValidator`** dall'anagrafica utenti
    (Persone → Anagrafica dipendente → *Validatore P.O.S.*); di fatto **Fausto
    Zanotti**, più gli ADMIN. Logica in `src/lib/pos.ts` (`canValidatePos`,
    `hasPosDocument`, `touchesPlanning`).
  - Campi su `Intervento`: `posValidated`, `posValidatedAt`,
    `posValidatedById` / `posValidatedByName`, `posSignature`, `posNote`.
  - Enforcement **server-side**: `PATCH /api/interventi/[id]` rifiuta (409)
    assegnazione tecnico / date / squadra e qualunque cambio di stato diverso da
    DOCUMENTAZIONE; `POST /api/interventi` crea sempre in DOCUMENTAZIONE.
    Il documento P.O.S. non si cancella se la validazione è attiva.
  - API: `POST /api/interventi/[id]/pos` (valida: flag + firma) ·
    `DELETE` (revoca: torna in DOCUMENTAZIONE se non è già partito).
  - UI: card **P.O.S.** nella scheda intervento (`src/components/PosCard.tsx`),
    banner di blocco, campi di pianificazione disabilitati, colonna kanban
    "Documentazione da validare", filtro *P.O.S. da validare*, notifiche
    dedicate e avviso nella Pianificazione (gli interventi bloccati non
    compaiono tra i "Da pianificare").
  - Backfill: `npm run service:backfill-pos` — grazia gli interventi storici
    (marcati "Storico (pre-P.O.S.)") e abilita il validatore.
- **Check list di collaudo M7.3** (`src/lib/checklist.ts`, 63 voci): card nello
  scopo Collaudo & Firme con stato (Da compilare / In corso / In attesa di
  approvazione / Approvato) e barra di avanzamento. Modal a tutta pagina con
  SI / NO / N.A. + note per ogni voce, firma compilatore (utente loggato — può
  salvare la firma personale `User.signatureImage`) e flusso di approvazione
  con firma approvatore. API: `/api/machines/[id]/collaudo` (save/submit/approve)
  + `/api/users/me` per la firma personale. Vincolo: il compilatore non può
  approvare il proprio verbale.

## Note operative

- Avvio sviluppo: `npm run dev` · build: `npm run build` · prod: `npm start` (porta 3000)
- DB: schema via `npx prisma db push`; seed `npm run db:seed`
- File caricati su disco in `uploads/<codice-macchina>/...`, serviti da
  `/uploads/[...path]` (con controllo sessione). `DATABASE_URL`/`AUTH_SECRET` in `.env`.
- Il formato Excel MATRICOLE ha 2 righe di intestazione (gruppo + sotto-colonna),
  dati da riga 3. Mappatura colonne in `src/lib/components.ts`, parser `src/lib/excel.ts`.
- Stack note: Next 16 + React 19 (aggiornati da 15/18 per la patch di sicurezza
  CVE-2025-66478). ESLint non gira più in `next build` (rimosso in Next 16).
- **Fix layout desktop**: la shell usa `display:flex` (`.app` flex, `.sidebar`
  `flex:0 0 248px`, `.main` `flex:1 1 0; min-width:0`) invece di CSS grid `1fr`,
  che collassava in alcuni browser embedded. Robusto su desktop/tablet/mobile.
- **Import massivo eseguito**: importate tutte le righe del file MATRICOLE →
  **187 macchine totali** in DB (6 esempio + 181 import, 7 duplicati saltati),
  **2356 matricole** censite, anni 2006-2026. Modello impostato a "Da definire"
  (il file non contiene il modello): modificabile per macchina.
