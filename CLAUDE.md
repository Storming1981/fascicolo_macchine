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
- **Ruoli** (`Role`): oltre ai ruoli operativi, due responsabili con guscio
  desktop — `RESPONSABILE_CANTIERI` (tutti i permessi) e
  `RESPONSABILE_PRODUZIONE` (fascicolo/produzione: creazione, stato, interventi
  a diario, firme, import, check list; Service in sola lettura; niente gestione
  operatori/impostazioni). Aggiungere un ruolo tocca sei punti: enum in
  `schema.prisma`, `ROLE_LABEL` (`domain.ts`, detta l'ordine negli elenchi),
  `DEFAULT_PERMISSIONS` (`permissions.ts`), `DEFAULT_APP_ACCESS`
  (`appAccess.ts`), `DEFAULT_NAV` (`nav.ts`) e la whitelist `ROLES` in
  `api/users/route.ts`.
- `Setting` — configurazione runtime (key/value Json): `plantConfig` (tipologie
  e modelli editabili) e `permissions` (matrice permessi per ruolo)
- `MachineMilestone` — date di cambio stato (key/date/source). Card "Date di
  stato" in Anagrafica + voci nel diario. **Il valore automatico prevale** e non
  si modifica dalla card (si corregge alla fonte); «Modifica date» completa a
  mano solo quelle senza fonte (source `MANUALE`). Fonti:
  - **Inizio / Fine produzione** → gestionale, prima / ultima timbratura (`avlavp`).
  - **Collaudo** → firma della check list di collaudo: `Collaudo.approvedAt`,
    altrimenti `compiledAt` (firma compilatore). Calcolata al volo.
  - **Spedita** → gestionale: **primo** DDT (`testmag.tm_tipork='B'`) con righe
    di scopo **SUPPLY** — `movmag.mm_hhcodsc='1'` (tabella `tabhhsc`: 1 SUPPLY,
    2 SPARE PARTS, 3 MAINTENANCE) — sulla commessa di vendita (`tm_commeca = job`).
    Attenzione: `tm_hhcoduf` sulla testata NON è lo scopo (è la tipologia cliente,
    `tabhhuf`). I DDT SUPPLY successivi sono completamenti. Arriva col sync
    (`shippedAt` in `erp.ts`, `applyErpData`, `/api/sync/erp`, **sync-agent**).
  - **Installata** → ultimo rapportino (chiuso, se ce ne sono) dell'intervento
    di tipo `INSTALLAZIONE` con commessa = job di vendita + 2 cifre
    (1260354 → 126035401); calcolata al volo.
  - **In esercizio / Dismessa** → manuale.
  Calcolo in `src/lib/milestoneAuto.ts` (`resolveMilestones`), definizioni e
  sorgenti in `src/lib/milestones.ts`.

### Impostazioni & Permessi

- Pagina **/impostazioni** (voce menu visibile solo a chi ha `settings.manage`;
  ADMIN sempre): due schede —
  - **Tipologie & Modelli**: CRUD tipologie impianto e relativi modelli
    (salvati in `Setting.plantConfig`); alimentano il wizard "Nuova macchina".
    Default da `src/lib/plant.ts` se non personalizzato.
    **Salvare la configurazione non tocca i fascicoli**: il riquadro *Modelli
    da aggiornare nei fascicoli* elenca i modelli usati dai fascicoli ma
    assenti dalla configurazione salvata (conteggio da `groupBy` in
    `page.tsx`) e li riallinea in blocco con *Applica* →
    `POST /api/settings/plant/apply-model` `{plantType, from, to}` (`to` deve
    essere configurato; nota "Modello: from → to" a diario di ogni fascicolo).
    Primo uso: BLUE DEVIL, 183 fascicoli CORPO TRITURATORE → GF4000.
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
  posizionato sul minuto giusto. **Un frammento per capitolo**, non per
  lunghezza: accorpandoli finiva tutto in un frammento a 0:00 e il minuto — che
  è il valore del video — si perdeva. Il titolo entra nel testo del frammento,
  altrimenti un capitolo breve ("Sezionamento LOTO") sta sotto la soglia minima
  e sparisce dall'indice.
- **Caricamento dei video: in streaming, due tempi.** Fino a 2 GB
  (`BRAIN_MAX_VIDEO_MB`); i documenti restano a 60 MB (`BRAIN_MAX_DOC_MB`).
  `req.formData()` tiene l'intero corpo in memoria — bene per un PDF, esplosivo
  per mezzo giga — quindi prima si creano i metadati (`POST` JSON con
  `awaitingFile: true`, nessuna indicizzazione) e poi il file arriva su
  `PUT /api/knowledge/sources/[id]/file`, che passa i byte dalla rete al disco a
  blocchi. Il client usa **XHR** perché `fetch` non espone l'avanzamento
  dell'upload. Lato proxy serve una `location` dedicata con
  `client_max_body_size 2g` e **`proxy_request_buffering off`**: senza, nginx
  scrive prima l'intero file in un suo temporaneo e solo dopo lo inoltra.

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

### Costi: dove vanno davvero i soldi

Misurato sul campo (non stimato), dopo i primi due giorni di uso:

| Voce | Costo | Note |
|---|---|---|
| Risposta singola | **~$0,09** | Opus 5, ~3.600 token input + ~1.250 output + scrittura cache |
| OCR di un manuale scansionato | **~$0,40** | 1.586 token/pagina, misurati con `count_tokens` |
| Espansione query (Haiku) | trascurabile | ~$0,002 a domanda |

Il primo conto fu di €10 in due giorni, e **l'80% erano reindicizzazioni**: sei
giri di OCR sugli stessi due manuali durante il debug del retrieval. Da qui le
tre difese, tutte già attive:

1. **Il testo estratto si tiene** (`extractCache` + `extractHash` = sha del
   FILE). Reindicizzare serve quasi sempre a migliorare chunking o ranking, non
   perché il PDF sia cambiato. Misurato: da **632 secondi e $0,40 a 0 secondi e
   $0**. Per forzare davvero la rilettura: `POST …/reindex?reextract=1`.
2. **Cache delle risposte** (`BrainAnswerCache`, `src/lib/brain/answerCache.ts`).
   La prompt cache di Anthropic copre il system prompt, **non** i documenti
   recuperati né la generazione: una domanda ripetuta costava quasi come la
   prima. Misurato: **$0,0920 / 19.656 ms → $0,0000 / 8 ms**. La chiave include
   la versione della knowledge base, quindi ogni caricamento o reindicizzazione
   fa decadere tutto da solo. Si memorizza **solo la prima domanda di una
   conversazione**: un "e i guanti?" dipende dal contesto precedente e riusarlo
   darebbe risposte a caso.
3. **Prompt cache a 1 ora** invece dei 5 minuti di default: 12 risposte su 26
   non leggevano un solo token dalla cache perché fra una domanda e l'altra
   passano minuti. Scrive a 2x invece di 1.25x e si ripaga alla prima lettura
   evitata.

> **I token SCRITTI in cache vanno contati.** Prima non li tracciavo e il costo
> per risposta sembrava $0,04 quando era $0,09. Ora `cacheWriteTokens` sta in
> `BrainMessage` e in `estimateCostUsd`.

Leve di qualità/costo **non** applicate (decisione del committente): `effort`
da `medium` a `low` (curve quasi piatte sulle domande di conoscenza: 1-3 punti
per un terzo/metà del costo) e modello più economico per le risposte
(sconsigliato: Haiku peggiora molto sul tecnico).

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

### Qualità del retrieval: otto cause, un solo sintomo

"Come accendo il BLUE DEVIL" non trovava la procedura, che sta a pagina 67 del
manuale (`6.2.1 Accensione`), e "quali controlli preliminari" ignorava la 68
(`6.2.2 Controlli preliminari`). Otto bug distinti davano lo stesso sintomo, e
nessuno era evidente. Vale la pena conoscerli tutti: si ripresenteranno con
ogni manuale nuovo.

1. **I piè di pagina si mangiavano il manuale.** Ogni pagina finiva in un
   frammento a sé (`BLUE DEVIL GF 4000 II — 16 / 105`): cortissimo (e `ts_rank`
   premia i corti) e col nome della macchina dentro (quindi agganciava ogni
   domanda che la nominasse). Col tetto di 3 frammenti per fonte, il manuale
   rispondeva **solo** con quelli. → `stripRunningHeaders()`.
2. **Il nome macchina nelle query.** Haiku scriveva "sequenza di avviamento
   BLUE DEVIL", ma dentro i capitoli il nome del prodotto non compare: la
   ricerca è in AND, quindi escludeva proprio le pagine buone. La tipologia era
   già un filtro sui metadati. → istruzione esplicita in `planQuery`.
3. **Lo stemmer italiano non lega verbo e sostantivo**: `accendere` → `accend`,
   `accensione` → `accension`. Zero risultati. → voci di dizionario che
   coprono i verbi di cantiere.
4. **Le voci di elenco numerate passavano per titoli.** `headingOf()` apriva un
   frammento a ogni "1. Aprire l'accesso principale": la procedura si spezzava
   passo per passo e i passi restavano staccati dalla parola "Accensione", cioè
   da come li si cerca. Ora fa titolo solo la numerazione gerarchica
   (`6.2.1 Accensione`) e i capitoli maiuscoli (`7 MANUTENZIONE`).
5. **Del dizionario si cerca il termine canonico, non gli alias.** Gli alias
   servono a riconoscere il gergo; usarli come query separate tirava dentro
   "5.7 PRIMO AVVIAMENTO" (la messa in servizio del costruttore, tutt'altra
   cosa) e diluiva la sezione giusta.

6. **La ricerca in AND non regge una domanda scritta per esteso.** Misurato:
   `"Quali controlli preliminare devo fare prima di avviare un Blue Devil"` →
   **0 frammenti**; `"controlli preliminari"` → 5, fra cui la sezione che si
   chiama proprio così. L'OR c'era ma scattava solo a fallimento dell'AND e
   valeva il 60%, quindi la sezione giusta finiva sotto alle tabelle che
   ripetono la parola — Postgres **non pesa i termini rari**, la ripetizione
   batte la pertinenza. Ora le due passate si sommano e si prende il meglio.
7. **Il titolo di sezione vale ×1.8**, ma solo sui termini distintivi. Chi
   chiede "i controlli preliminari" intende il capitolo che si chiama così. Col
   premio su qualunque parola, però, `impianto` promuoveva "1.2 DATI
   IDENTIFICATIVI DELL'IMPIANTO" a ogni domanda: fuori i nomi di prodotto (la
   tipologia è già un filtro sui metadati) e le parole onnipresenti.
8. **Occhio alle radici che collidono.** `prima` e `primo` hanno lo stesso
   stem, quindi "cosa faccio **prima** di avviare" si agganciava a "5.6
   **PRIMO** AVVIAMENTO", che parla d'altro. Le parole che non discriminano
   stanno in `STOPWORDS`.

**Non si tocca il ranking senza la suite.** Tre volte di fila una correzione ha
risolto una domanda e rotto un'altra:
`docker compose run --rm tools npx tsx scripts/test-retrieval.ts` fissa
domanda → sezione attesa nei primi cinque risultati. Va eseguita dopo ogni
modifica a `retrieve.ts`, `chunk.ts` o al dizionario.

`npm run brain:test-headers` copre la pulizia delle testate e il riconoscimento
dei titoli: entrambe le regole hanno trappole (un titolo di capitolo ripetuto
non va cancellato; "67 / 105" non è un titolo numerato) trovate dal test e non
in produzione.

**Come si diagnostica**: non tirare a indovinare sul ranking. Si guarda cosa
contengono davvero i frammenti che hanno vinto
(`SELECT page, length(text), left(text,120) FROM "KnowledgeChunk" …`) — in
questo caso bastava a capire tutto. Utile anche `to_tsvector('italian', …)`
per verificare le radici delle parole.

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

Stato in produzione: 207 fonti, 884 frammenti, 48 termini a dizionario. Due
manuali scansionati indicizzati via OCR (GF4000 BLUE DEVIL 105 pagine → 226
frammenti; CAYMAN → 243) più il corpus operativo (diari, rapportini, chat).

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
- **Foto a cartelle** (linguetta *Foto produzione*): niente più filtri per
  categoria, ma cartelle. **Componenti** (automatica: foto con
  `componentItemId`, titolo "Gruppo — Slot"), **Produzione** e **Collaudo**
  (caricamento manuale, la cartella fissa la categoria; le vecchie categorie
  telaio/idraulica/elettrico/finiture restano sotto Produzione), **Interventi**
  (automatica) con una **sottocartella per intervento** di service col codice
  `INT-…` (foto di rapportini e chat via `Photo.interventoId`), poi quelle del
  diario del fascicolo (`diaryEventId`). Classificazione in `folderOf()`.
- **Eliminazione foto** (icona cestino sulla card in *Foto produzione*): la
  elimina l'autore della foto o chi ha `machine.edit`. Cancellazione **logica**
  (`Photo.deletedAt`/`deletedById`/`deletedByName`): riga e file su disco
  restano, la foto sparisce da cartelle, slot e intervento (i loader filtrano
  `deletedAt: null`), e a diario va l'evento **"Foto eliminata"** con cartella,
  autore originale, data e path del file. Cartella **Cestino** (grigia, sempre
  visibile) con chi ha eliminato e quando + pulsante *Ripristina*: la foto torna
  nella cartella d'origine e a diario va "Foto ripristinata dal cestino". Il
  loader passa le eliminate a parte in `photoTrash`.
  API: `DELETE /api/machines/[id]/photos/[photoId]` · `PATCH …` `{restore:true}`.
- **Matricola da foto (OCR)**: pulsante fotocamera nella cella matricola →
  `POST /api/vision/serial` → `src/lib/serialOcr.ts` (**Claude Opus 5**,
  effort medium, output JSON: serial + etichetta + confidenza + codici letti)
  su copia ridotta a 1600 px (`src/lib/image.ts`); l'originale va sullo slot.
  **Salvataggio automatico** se lo slot è vuoto e la confidenza non è bassa
  (evento a diario "Matricola assegnata"); se lo slot ha già un'altra matricola
  o la lettura è incerta resta una proposta (campo giallo) da confermare con ✓.
  - Perché non Haiku: le targhette dei riduttori ZATO in foto sono ruotate o
    capovolte e hanno accanto tipo (GB.26004.FS) e rapporto (1:400). Misurato
    su 10 foto reali di M-2026-0007: Haiku 6/10 (0/4 sui riduttori: cifre
    perse, zeri iniziali tolti, tipo al posto della matricola), Opus 5 10/10.
  - Il primo flusso chiedeva sempre ✓: nessuno lo premeva e il 14/09 10 foto
    su slot sono rimaste senza matricola.
- **Miniature nello slot componente**: la colonna Foto di Componenti &
  Matricole mostra l'ultima foto dello slot (clic = apre) con il conteggio
  delle altre; prima la foto finiva solo in Foto produzione perché il loader
  non passava `componentItemId`.
- **Kit tirante giunto** (solo `BLUE DEVIL`, `hasTiranteGiunto()` in
  `plant.ts`): spunta in testa a Componenti & Matricole, campo
  `Machine.tiranteGiunto`, `POST /api/machines/[id]/kit` (permesso
  `machine.intervention` o `machine.edit`, 400 sulle altre tipologie), ogni
  cambio annotato a diario. Colonna *Tirante giunto* nell'elenco macchine
  (casella in sola lettura, "—" per le non BLUE DEVIL).
- **Schede di allestimento per tipologia impianto** — dove ci sono, sono
  l'**unica** vista di Componenti & Matricole (l'elenco per gruppo resta per le
  tipologie senza scheda). Mappatura in `sheetKindsFor()`:
  **BLUE DEVIL** → M5.16 Trituratore + M5.17 Container · **BLUE SHARK** → M5.6
  Mulino · **CESOIE** e **SPACCABINARI** → M5.18 Scheda costruzione cesoie.
  Ogni `SheetDef` dichiara `plantTypes` e `headerFields` (`collaudatoDa` per le
  schede BLUE DEVIL, `matricola` per mulino e cesoia). Le righe con
  `serialList` hanno un **elenco anche nella colonna Matricola** (le marche del
  modulo cartaceo: IMI/RIVAL/AVEROLDI, PSP/GELLI, ...), con le stesse voci
  aggiungibili delle specifiche (chiave `KIND.row#marca`). Mulino e cesoia non
  hanno righe condizionali: entrambe le alimentazioni (elettrica e diesel) stanno
  sul modulo e si compila quella che serve.
- **Check list di collaudo per tipologia** (`checklistFor()` in
  `src/lib/checklist.ts`): **CESOIE / SPACCABINARI → M5.7 CHECK LIST CESOIA**
  (28 voci, raggruppate in sezioni: lame, link, cesoia, funzionali, generali,
  verniciatura); tutte le altre tipologie restano sulla **M7.3** (63 voci). La
  colonna "NC" del modulo cartaceo non esiste a video: il riferimento della non
  conformità va nella nota della voce. Il flusso (compila → firma → approva) e
  l'API `/api/machines/[id]/collaudo` sono gli stessi.
- **Schede BLUE DEVIL** (M5.16 Trituratore / M5.17 Container):
  Intestazione non editabile: Tipo GF trituratore sempre **GF4000**; *Collaudato
  da* (su entrambe) = compilatore che firma la check list di collaudo M7.3
  (`Collaudo.compilerName`), calcolato in `fixedHeader`. Definizioni in `src/lib/allestimento.ts`.
  **Nessun dato duplicato**: le righe con matricola puntano ai gruppi componente
  (la specifica è `Component.brand` o un campo `extra`, le matricole sono gli
  slot con OCR/foto), il resto (colori, fornitori, controlli Sì/No/N.a.) sta in
  `AllestimentoSheet.values`. Mappature scelte: condizionatore = `cooling`,
  radiatori = `dissipators`, Valvola Max = `hyd_pumps.extra.valves`, taglio di
  pressione prende di default `pressureSettings`; quadro elettrico e HMI in una
  sezione in più del container (non sono sul modulo). Nuovo gruppo
  `motor_blocks` (Blocchi motore), creato al volo sui fascicoli esistenti da
  `ensureSheetComponents`. Tipo container E/D mostra motori elettrici o diesel.
  Firma compilatore (penna o firma personale) → evento a diario; se la scheda
  firmata viene modificata la firma decade. PDF rigenerato dai dati correnti
  (`src/lib/allestimentoPdf.ts`, una pagina A4 come il modulo).
  **Elenchi con voci aggiungibili**: ogni specifica non libera (`free`) è una
  tendina che parte dai `suggest` e si arricchisce con le voci aggiunte dagli
  operatori, salvate in `Setting.allestimentoOptions` per elenco (`list`
  condiviso — colori, verniciatura, lavorazioni, ghiere, tensione, frequenza —
  oppure `KIND.rowKey`). Anche un valore scritto a mano entra nell'elenco al
  salvataggio; doppioni ignorati senza badare alle maiuscole. Aggiunge chi
  compila, toglie chi ha `machine.edit`. API `GET|POST|DELETE /api/allestimento/options`.
  API: `GET|PUT|POST /api/machines/[id]/allestimento` ·
  `GET /api/machines/[id]/allestimento/[kind]/pdf`.
- **Invio schede via e-mail** (pulsante *Invia via e-mail* nelle schede di
  allestimento): A / Cc / oggetto / messaggio + scelta dei PDF (M5.16, M5.17)
  generati al momento (`renderSheetPdf` in `src/lib/allestimentoRender.ts`,
  condiviso con la stampa). Parte dalla casella Gmail personale dell'utente, o da
  quella aziendale se non l'ha collegata; l'invio va a diario con mittente e
  destinatari. `POST /api/machines/[id]/allestimento/send` (permesso
  `machine.intervention` o `machine.edit`).
- **Profilo utente** (`/profilo`, clic su avatar o nome in topbar/sidebar):
  foto (ridotta a 256 px), telefono, **casella Gmail personale** (Accedi con
  Google → `/api/google/auth?target=me&return=profilo`, la callback torna al
  profilo; prova e scollega), cambio **password** e **PIN di firma** (entrambi
  richiedono la password attuale), **firma personale**. Nome, e-mail e ruolo
  restano all'amministratore. `GET|PATCH /api/users/me`. Prima il collegamento
  Gmail personale era raggiungibile solo da Impostazioni (`settings.manage`).
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
- **Note macchina** (linguetta *Note*, dopo QR & Etichetta): appunti liberi su
  settaggi particolari e aggiustaggi dedicati, firmati con autore + data/ora.
  Ogni modifica salva il testo sostituito in `MachineNoteRevision` (chi e
  quando), consultabile da *Versioni precedenti*. La **cancellazione è logica**:
  la nota va nel **Cestino** (`deletedAt`/`deletedByName`), visibile dal filtro
  *Note / Cestino* con chi l'ha eliminata e quando, e si **ripristina**; nel
  cestino non si modifica (409). Dal DB non si cancella mai. Aggiunge chi ha
  `machine.intervention` o `machine.edit`; modifica, elimina e ripristina
  l'autore oppure chi ha `machine.edit`.
  API: `POST /api/machines/[id]/notes` · `PATCH …/notes/[noteId]` (`{text}` o
  `{restore:true}`) · `DELETE …/notes/[noteId]` (sposta nel cestino).
- **Import Excel/CSV**: anteprima (dry-run) + conferma; salta job già presenti.
- **Persone**: elenco operatori, firme, creazione operatore (solo ADMIN).
  Gli **accessi al portale cliente** (utenti con ruolo `CLIENTE`) sono **nascosti
  di default**: si gestiscono dalla scheda del cliente e qui gonfierebbero solo
  l'elenco. Filtro in barra *Operatori / Accessi portale / Tutti*; il ruolo
  `CLIENTE` non e' assegnabile dalla modale "Nuovo operatore" (quegli utenti
  nascono con il `customerId` agganciato).
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

- **Notifiche di cantiere** (`Notification`, `src/lib/notifications.ts`,
  `src/lib/interventoNotify.ts`, `src/lib/notifyMail.ts`): quando si assegna il
  **capo cantiere** di un intervento, quell'utente riceve il **pallino rosso col
  numerino** sulla campanella e una **mail** con tutto il cantiere.
  - **Un solo punto di innesco**: `PATCH /api/interventi/[id]`. Le tre strade per
    assegnare (tendina nella scheda, modale Squadra, drag della Pianificazione)
    passano tutte di lì, quindi non serve agganciare nulla altrove.
  - **Il brief** (`loadInterventoBrief`) raccoglie tipo, priorità, stato,
    cliente + telefono, cantiere con indirizzo, macchina (codice/tipologia/job),
    commessa, periodo, SLA, capo cantiere, squadra e descrizione. La stessa
    struttura alimenta pannello e mail: un dato si aggiunge in un posto solo.
  - **Non si rinotifica a vuoto**: la route rilegge lo stato *prima* della
    modifica e confronta. Senza, ogni salvataggio della scheda rispedirebbe
    notifica e mail alle stesse persone. Quattro casi: `INTERVENTO_ASSEGNATO`
    (nuovo capo cantiere), `INTERVENTO_SQUADRA` (entra), `INTERVENTO_RIMOSSO`
    (esce dalla squadra **o viene sostituito come capo cantiere**),
    `INTERVENTO_RIPROGRAMMATO` (date spostate per chi c'era già). Chi fa la
    modifica non si autonotifica. Il capo cantiere sostituito va avvisato per
    forza: e' il caso che fa piu' danno, perche' altrimenti in due si preparano
    per lo stesso cantiere.
  - **La mail parte dopo la risposta HTTP** (`after()`): assegnare un intervento
    non deve fallire perché Gmail è lento o nessuno ha collegato una casella.
    L'esito resta sulla riga (`emailSentAt` / `emailFrom` / `emailError`),
    altrimenti una mail mai partita non si scoprirebbe mai. Mittente =
    `sendGmailAs(chi assegna)`: casella personale se collegata, altrimenti
    quella aziendale — il capo cantiere può rispondere a chi gli ha dato il
    cantiere.
  - **Indirizzi non recapitabili**: 11 dei 21 utenti attivi sono operatori
    importati dal timbratore e hanno `NNN@timbratore.local` (gli accessi portale
    hanno `@portale.zato`). Non sono caselle vere: `notifyMail.ts` le scarta e
    scrive il motivo in `emailError`, invece di riempire di bounce la posta di
    chi assegna. **La notifica nell'app arriva lo stesso** — per far partire
    anche la mail basta mettere l'indirizzo vero in Persone.
  - **Notifica ad app chiusa (Web Push)** — la campanella si aggiorna col
    polling, ma **solo mentre l'app è aperta**: il capo cantiere che riceve il
    cantiere la sera, col telefono in tasca, senza push lo scoprirebbe solo
    dalla mail. Pezzi: `public/sw.js` (service worker), `src/lib/push.ts`
    (invio, `web-push`), `src/lib/pushClient.ts` (iscrizione lato browser),
    `POST|GET|DELETE /api/push`, modello `PushSubscription`.
    - **L'iscrizione è per DISPOSITIVO, non per utente**: telefono e tablet
      dello stesso tecnico sono due righe, e si spedisce a tutte. La chiave
      naturale è `endpoint` (l'URL del push service), con upsert: il browser lo
      rigenera quando l'iscrizione decade e senza upsert si accumulerebbero
      doppioni morti.
    - **Il permesso si chiede solo da un gesto**: `requestPermission()` al
      caricamento viene rifiutato in blocco dai browser, e su Safari brucia
      l'unica occasione (un "no" non si ripropone). Da qui il bottone *Attiva*
      in testa al pannello della campanella, che subito dopo manda una **prova**
      (`POST /api/push {test:true}`): l'utente deve poter verificare da solo,
      senza aspettare che qualcuno gli assegni un cantiere.
    - **Su iPhone e iPad serve l'app installata** (Condividi → Aggiungi alla
      schermata Home): da Safari normale l'API esiste ma l'iscrizione fallisce
      sempre. Il pannello lo dice, invece di mostrare un bottone che non
      funzionerà mai.
    - **Le iscrizioni morte si cancellano da sole**: a 404/410 la riga sparisce
      (app disinstallata, permesso revocato, endpoint ruotato), altrimenti
      resterebbe a fallire per sempre a ogni notifica. Gli altri errori
      incrementano `failCount` **e finiscono a log**: un push rotto per
      configurazione (VAPID sbagliata, proxy che blocca) sparirebbe senza
      lasciare traccia e nessuno riceverebbe più niente.
    - Il service worker **non fa cache offline**: l'app è server-rendered e una
      cache sbagliata servirebbe fascicoli vecchi, che in cantiere è peggio di
      un errore di rete. Gestisce solo `push` e `notificationclick`.
    - Il push porta **solo la frase di apertura + cliente · cantiere · date**:
      sulla schermata bloccata il brief intero verrebbe troncato a metà parola.
    - **`web-push` va in `serverExternalPackages`** (`next.config.ts`): senza,
      non finisce in `.next/standalone/node_modules` e in container il push
      muore. È la stessa trappola del worker di pdfjs, e in locale non si vede
      perché lì `node_modules` è completo. Verificato su due build pulite.
    - Chiavi VAPID in `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
      `VAPID_SUBJECT`), generate con `npm run push:keys`. **Rigenerarle invalida
      tutte le iscrizioni** già fatte dai dispositivi. Senza chiavi l'app parte
      identica: restano campanella e mail.
    - Prova senza browser: `npm run push:test` — verifica firma VAPID,
      `aes128gcm`, che il payload sia davvero cifrato e che un 410 cancelli
      l'iscrizione. Se questa passa e sul telefono non arriva niente, il
      problema è il permesso del browser o il proxy, non il server.
  - **UI**: `src/components/NotificationBell.tsx` in **entrambi i gusci** — il
    capo cantiere sta sul tablet, quindi la campanella c'è anche in Campo, dove
    il pannello va quasi a tutto schermo e il clic porta a
    `/campo/interventi/[id]` invece che alla pagina desktop. Polling a 45s solo
    a scheda visibile (ad app aperta; ad app chiusa arriva il push), più il
    numerino sull'icona dell'app installata via **Badging API**
    (`navigator.setAppBadge`, silenzioso dove non c'è).
  - **Due pagine diverse, nomi diversi**: `/notifiche` ("Le mie notifiche") è
    l'archivio personale dietro alla campanella; `/service/notifiche`
    ("Avvisi Service") resta il cruscotto del service (SLA, P.O.S. da validare)
    e guarda gli interventi di tutti.
  - **Il vincolo P.O.S. viene prima**: finché il piano non è validato la route
    rifiuta l'assegnazione (409), quindi la prima notifica non può partire prima
    che il cantiere sia davvero assegnabile.
  - API: `GET /api/notifications` (`?count=1` per il solo numerino) ·
    `POST /api/notifications` (`{ids}` o `{all:true}` per segnare lette).
    Prova a secco senza inviare nulla: `npm run notif:test [INT-2491]`.

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
- **Riepilogo intervento in un PDF solo** (`src/lib/riepilogoPdf.ts` +
  `riepilogoRender.ts`): tutte le giornate una dopo l'altra (ore per operatore
  con tipologia, attività e problematiche), totale per operatore e **una sola
  firma in fondo**, per le installazioni lunghe dove il cliente firma a fine
  lavori invece che ogni giorno. I rapportini giornalieri restano come sono.
  Firme (tecnico + cliente) raccolte dalla scheda intervento e salvate su
  `Intervento.summary*`; il PDF si rigenera sempre dai dati correnti.
  API: `GET /api/interventi/[id]/riepilogo/pdf` ·
  `POST|DELETE /api/interventi/[id]/riepilogo` (firma / revoca, `intervento.edit`).
  Colori, carta intestata e `san()` sono condivisi col rapportino in
  `src/lib/pdfCommon.ts`. **Il piede della carta intestata è alto 143 pt**: il
  blocco firma spesso finisce su una pagina sua, che infatti ripete il
  riferimento dell'intervento.
- **Tipologia timbratura nel rapportino** (Lavoro / Viaggio): il timbratore la
  espone nella colonna **12** della tabella `/stampings` (`StampingRow.tipologia`,
  13 = "tipologia di lavoro", non usata). Viaggia con le sessioni
  (`CommessaHours.sessions[].type`) → `sync-ore` la salva in
  `Rapportino.timbrature[].type` → colonna *Tipologia* nella scheda intervento
  (targhetta ambra per il viaggio) e nel PDF, con riga **"di cui viaggio"** sotto
  al totale di giornata. I rapportini gia' esistenti prendono la tipologia al
  primo *Sincronizza ore*.
- **Link assoluti dietro al proxy** (`src/lib/absoluteUrl.ts`): in build standalone
  `new URL(path, req.url)` restituisce l'indirizzo di ascolto del container, non il
  dominio: il ritorno dal consenso Google finiva su `https://0.0.0.0:3000/profilo`
  (ERR_ADDRESS_INVALID) a collegamento gia' riuscito. Si costruiscono dagli header
  `x-forwarded-proto` / `x-forwarded-host` (fallback `host`). Usato da callback e
  auth Google, login e logout.
- **Ore in ore e minuti** (`fmtHM` in `src/lib/format.ts`): le sessioni nascono da
  timbrature HH:MM, quindi la somma decimale non si legge ("8.72" sono 8h 43m).
  Usata nel PDF rapportino e nella scheda intervento. **Non** per `plantHours`
  (contaore dell'impianto: e' un contatore, non una durata).
- **Import massivo eseguito**: importate tutte le righe del file MATRICOLE →
  **187 macchine totali** in DB (6 esempio + 181 import, 7 duplicati saltati),
  **2356 matricole** censite, anni 2006-2026. Modello impostato a "Da definire"
  (il file non contiene il modello): modificabile per macchina.
