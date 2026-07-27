# Sync-agent ERP — Fascicolo Tecnico Macchina

Importa i dati di produzione dal **gestionale ZATO** (SQL Server, Zucchetti AdHoc)
verso i fascicoli macchina su **machines.zatospa.it**, via HTTPS.

## Perché serve

L'app gira su una VPS che **non vede** il SQL Server aziendale (`192.168.1.144`
è un IP di LAN interna). Questo agent gira **in azienda** su un PC con accesso al
gestionale: interroga il SQL Server ed è lui a *spingere* i dati all'app. Nessuna
connessione entra in azienda dall'esterno — è sempre l'agent a chiamare la VPS.

Per ogni fascicoli aggiorna: **cliente**, **paese**, **descrizione commessa**,
**ore di lavorazione** e le **date di inizio/fine produzione** (che diventano
anche milestone nel diario, con origine `GESTIONALE`). Sono gli stessi campi del
pulsante *Sincronizza tutti i fascicoli* in Impostazioni, che però funziona solo
in rete aziendale.

## Come funziona

1. `GET /api/sync/erp/machines` → lista fascicoli con i loro job/ordini.
2. Per ciascuno esegue le query su `commess` / `anagra` / `tabstat` / `avlavp`
   (identiche a `src/lib/erp.ts` dell'app) e calcola l'aggregato.
3. `POST /api/sync/erp` → invia i risultati a batch; l'app scrive nel DB.

L'autenticazione è una **API key** `sk_sync_...` passata come
`Authorization: Bearer`, condivisa tra agent e app.

## Setup (una tantum)

### 1. Genera la API key (sulla VPS, nella cartella dell'app)

```bash
npx tsx scripts/gen-sync-key.ts
```

Copia la riga `SYNC_API_KEY=sk_sync_...`:
- nella VPS in **`.env.production`** (poi `docker compose up -d` per applicarla);
- qui nell'agent in **`.env`** (vedi sotto).

### 2. Configura l'agent (sul PC aziendale)

```bat
cd sync-agent
npm install
copy .env.example .env
REM apri .env e valorizza SYNC_API_KEY, SQLSERVER_USER, SQLSERVER_PASSWORD
```

### 3. Verifica connessione (nessuna scrittura)

```bat
npm run test-conn
```

Deve stampare `SQL Server OK` e `API OK: N fascicoli`.

### 4. Prova a vuoto (interroga il gestionale ma non scrive)

```bat
npm start -- --dry-run --limit 10
```

### 5. Sync reale

```bat
npm start
```

## Comandi

```bat
npm start                    REM sync completo
npm start -- --test-conn     REM solo test SQL + API
npm start -- --dry-run       REM interroga il gestionale, NON invia
npm start -- --limit 20      REM solo i primi 20 fascicoli (prove)
```

## Pianificazione (Windows Task Scheduler)

Su un PC sempre acceso con accesso al SQL Server, schedula **`run-sync-hidden.vbs`**
(non il `.bat`: il `.vbs` non fa comparire la finestra nera). Frequenza consigliata:
**una o due volte al giorno** — i dati di produzione cambiano lentamente.

Il log finisce in `sync.log` nella cartella dell'agent. Un lock file (`.sync.lock`)
impedisce esecuzioni sovrapposte.

## Troubleshooting

| Messaggio | Causa / rimedio |
|-----------|-----------------|
| `SYNC_API_KEY non valida` | La chiave deve iniziare con `sk_sync_`. Rigenerala e allinea i due `.env`. |
| `GET /api/sync/erp/machines 401` | La chiave sull'agent ≠ quella in `.env.production` sulla VPS (o VPS non riavviata). |
| `GET ... 503 Sync non configurato` | `SYNC_API_KEY` vuota in `.env.production` sulla VPS. |
| `Errore connessione SQL Server` | PC non in rete con `192.168.1.144:1433`, credenziali errate o firewall. |
| `0 fascicoli con commessa trovata` | I job non sono numerici / non presenti in `commess`: verifica in Anagrafica. |
