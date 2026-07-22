# Zato Dashboard - Sync Agent

Sync agent che importa Revenues e Backlog dai DB gestionali (ZATO + ZATONA su SQL Server) verso il dashboard `finance.zatospa.it` via HTTPS.

## Logica di sintesi

1. **Tassi di cambio.** L'agent scarica i rate USD/EUR del mese dal dashboard (`GET /api/sync/exchange-rates`). Devono essere stati impostati a mano sul pannello admin del dashboard.
2. **Query gestionale.** Esegue le query (`dwarehe` + join multipli) su entrambi i DB:
   - **ZATO** → valori in EUR, esclude il cliente "Zato North America" (per `an_conto` configurato).
   - **ZATONA** → valori in USD, convertiti in EUR usando il rate del mese.
3. **Push.** Invia il merge dei due DB al dashboard:
   - `POST /api/sync/revenues` → replace totale dell'anno indicato
   - `POST /api/sync/backlog` → replace per `snapshotDate`

## Setup

```bash
cd sync-agent
npm install
cp .env.example .env
# Modifica .env con la API key, la password SQL, e l'an_conto di Zato NA
```

### Generazione API key (sul VPS del dashboard)

```bash
cd Dashboard_Zato
npx tsx scripts/generate-sync-api-key.ts "zato-dashboard-sync-agent"
# Copia la chiave in chiaro mostrata UNA SOLA VOLTA in sync-agent/.env -> SYNC_API_KEY
```

### Trovare il codice an_conto di Zato North America nel DB ZATO

```bash
cd sync-agent
npm start -- --find-customer --db ZATO "Zato North America"
# Copia il valore an_conto in .env -> ZATO_EXCLUDE_AN_CONTO
```

## Comandi disponibili

```bash
# Sync default (revenues anno corrente + backlog snapshot oggi)
npm start

# Solo revenues, anno corrente
npm start -- --revenues

# Solo revenues, anno specifico
npm start -- --revenues --year 2025

# Solo backlog, snapshot di oggi
npm start -- --backlog

# Solo backlog, snapshot specifico
npm start -- --backlog --snapshot 2026-05-20

# Discovery (debug) - lista tabelle di un DB
npm start -- --discover --db ZATONA

# Trova codice an_conto di un cliente
npm start -- --find-customer --db ZATO "Zato"
```

## Windows Task Scheduler

Il deploy tipico in azienda prevede un PC sempre acceso con accesso al SQL Server. Si schedulano due task:

| Task             | Wrapper                       | Frequenza suggerita |
|------------------|-------------------------------|---------------------|
| Sync revenues    | `run-revenues-hidden.vbs`     | Ogni 4-6 ore        |
| Sync backlog     | `run-backlog-hidden.vbs`      | Ogni 4-6 ore        |
| Sync completo    | `run-sync-hidden.vbs`         | Una volta a notte   |

Lancia il `.vbs` invece del `.bat` per non far comparire la finestra cmd.

## Troubleshooting

### "X righe ZATONA scartate per mancanza di rate"

Significa che mancano i tassi USD/EUR per uno o più mesi. Vai su `https://finance.zatospa.it/dashboard/admin/exchange-rates`, inserisci il rate del mese corrente (verrà propagato anche ai mesi precedenti dell'anno), e rilancia il sync.

### "SYNC_API_KEY non valida"

La chiave deve iniziare con `sk_sync_`. Rigenerala con lo script `scripts/generate-sync-api-key.ts`.

### "Errore connessione SQL Server"

Verifica che:
- Il PC dell'agent sia in rete con `192.168.1.144:1433`
- L'utente SQL abbia accesso a entrambi i DB (ZATO e ZATONA)
- Il firewall non blocchi la porta 1433
