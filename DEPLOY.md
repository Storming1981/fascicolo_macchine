# Deploy — machines.zatospa.it

Prima pubblicazione su VPS con **Docker**, **PostgreSQL già installato sulla VPS**
e **reverse proxy già presente**. L'app gira in container in ascolto solo su
`127.0.0.1:3000`; il proxy la pubblica in HTTPS.

---

## 0. Prerequisiti

- DNS: record **A** `machines.zatospa.it` → IP della VPS (verifica: `dig +short machines.zatospa.it`).
- Sulla VPS: Docker + plugin Compose (`docker compose version`).
- PostgreSQL raggiungibile su `localhost:5432`.

---

## 1. Database dedicato (sulla VPS)

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE fascicolo LOGIN PASSWORD 'PASSWORD_FORTE';
CREATE DATABASE fascicolo_macchine OWNER fascicolo;
\q
```

---

## 2. Codice + configurazione

```bash
sudo mkdir -p /srv/machines-zato/uploads
sudo chown -R 1001:1001 /srv/machines-zato/uploads   # uid del container

cd /srv
sudo git clone https://github.com/Storming1981/fascicolo_macchine.git machines-zato-app
cd machines-zato-app

cp .env.production.example .env.production
openssl rand -base64 48          # copia il risultato in AUTH_SECRET
nano .env.production             # DATABASE_URL, AUTH_SECRET, PRESENCE_*, GOOGLE_*
```

> `.env.production` è in `.gitignore`: non finisce mai su GitHub.

---

## 3. Build e schema del database

```bash
docker compose build                              # prima build (qualche minuto)
docker compose run --rm tools npx prisma db push  # crea le tabelle
```

**Solo se parti da zero** (senza migrare i dati locali), crea l'utente admin:
```bash
docker compose run --rm tools npm run db:seed     # admin@zato.it / zato2026
```

---

## 4. Migrazione dei dati esistenti (dal PC di sviluppo)

### 4.1 Database

Sul **PC Windows** (PowerShell, nella cartella del progetto):
```powershell
# dump del DB locale (porta 5433)
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" `
  --dbname "postgresql://postgres:1234@localhost:5433/fasciolo_macchine" `
  --format=custom --no-owner --no-privileges --file fascicolo.dump

scp fascicolo.dump utente@IP_VPS:/tmp/
```

Sulla **VPS**:
```bash
# ATTENZIONE: sovrascrive il contenuto del DB di destinazione
sudo -u postgres pg_restore --dbname fascicolo_macchine \
  --clean --if-exists --no-owner --no-privileges /tmp/fascicolo.dump
sudo -u postgres psql -d fascicolo_macchine \
  -c "GRANT ALL ON SCHEMA public TO fascicolo;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO fascicolo;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO fascicolo;"

rm /tmp/fascicolo.dump
```
Poi riallinea lo schema (in caso di modifiche successive):
```bash
cd /srv/machines-zato-app && docker compose run --rm tools npx prisma db push
```

### 4.2 File caricati (foto, firme, PDF)

Dal **PC Windows**:
```powershell
scp -r .\uploads\* utente@IP_VPS:/tmp/uploads/
```
Sulla **VPS**:
```bash
sudo rsync -a /tmp/uploads/ /srv/machines-zato/uploads/
sudo chown -R 1001:1001 /srv/machines-zato/uploads
rm -rf /tmp/uploads
```

---

## 5. Avvio

```bash
docker compose up -d
docker compose ps
docker compose logs -f app        # Ctrl+C per uscire
curl -I http://127.0.0.1:3000/login   # atteso: 200
```

---

## 6. Reverse proxy + HTTPS

Usa `deploy/nginx-machines.zatospa.it.conf` (contiene anche la variante Caddy):

```bash
sudo cp deploy/nginx-machines.zatospa.it.conf /etc/nginx/sites-available/machines.zatospa.it
sudo ln -s /etc/nginx/sites-available/machines.zatospa.it /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d machines.zatospa.it
```

Punti chiave già inclusi: `client_max_body_size 32m` (upload foto/documenti fino a
25 MB) e gli header `X-Forwarded-*`.

---

## 7. Dopo il primo avvio

1. **Login** su https://machines.zatospa.it e **cambia subito la password admin**
   (Persone & Firme). Le password di seed `zato2026` non vanno lasciate in produzione.
2. **Google/Gmail**: in Google Cloud Console aggiungi il redirect URI
   `https://machines.zatospa.it/api/google/callback`, poi ricollega l'account.
3. **Ruoli e accessi**: Impostazioni → Permessi / Menu & Navigazione. Verifica che
   gli operai abbiano profilo *Solo Campo*.

---

## 8. Aggiornamenti

```bash
cd /srv/machines-zato-app
git pull
docker compose build app tools                     # ATTENZIONE: anche `tools`
docker compose run --rm tools npx prisma db push   # solo se lo schema è cambiato
docker compose up -d
docker image prune -f
```

> **Ricostruisci sempre anche `tools`, non solo `app`.** L'immagine `tools`
> contiene una *copia* del codice (quindi di `prisma/schema.prisma`): se resta
> vecchia, `prisma db push` confronta il DB con lo **schema vecchio** e risponde
> allegramente *"The database is already in sync"* senza applicare nulla. Poi
> l'app nuova parte contro un DB senza le colonne nuove e va in errore.
> Verifica sempre l'esito sul DB, es.:
> ```bash
> sudo -u postgres psql -d fascicolo_macchine >   -c "\d \"Intervento\"" | grep pos
> ```

Se l'aggiornamento porta uno **script di migrazione dati** (es.
`service:backfill-pos`), eseguilo **dopo il `db push` e prima di `up -d`**:
```bash
docker compose run --rm tools npm run service:backfill-pos
```

---

## 9. Backup (consigliato: cron giornaliero)

```bash
# /etc/cron.daily/backup-machines-zato  (chmod +x)
#!/bin/bash
set -e
D=/var/backups/machines-zato; mkdir -p "$D"
S=$(date +%F)
sudo -u postgres pg_dump --format=custom fascicolo_macchine > "$D/db-$S.dump"
tar czf "$D/uploads-$S.tar.gz" -C /srv/machines-zato uploads
find "$D" -type f -mtime +30 -delete
```

I file in `/srv/machines-zato/uploads` sono **l'unico dato non ricostruibile**
oltre al database: vanno sempre inclusi nel backup.

---

## 10. Gestionale ERP (SQL Server) — da fare dopo

`192.168.1.144` è un indirizzo di **LAN aziendale**: dalla VPS non è raggiungibile.
Perciò in `.env.production` le variabili `SQLSERVER_*` restano **vuote** e l'app
degrada con grazia (card "Dati gestionale", sync commesse e ricerca articoli
disattivate; tutto il resto funziona, **timbrature comprese** perché il timbratore
è pubblico su Internet).

Per abilitarlo si segue lo stesso schema di `finance.zatospa.it`: un **sync-agent
on-premise** (PC in azienda con accesso al SQL Server, schedulato con Task
Scheduler) che interroga il gestionale e **spinge i dati alla VPS via HTTPS** con
una API key. Lato app servirà aggiungere:

- una tabella di API key + endpoint `POST /api/sync/...` autenticati;
- un agent (come `File riferimento/sync-agent esempio`) che mappa commesse,
  ore timbrate, anagrafiche clienti e articoli.

In alternativa, se in futuro la VPS avrà una VPN verso la rete aziendale, basterà
valorizzare le `SQLSERVER_*` e riavviare il container.

---

## Riferimento rapido

| Cosa | Percorso / comando |
|---|---|
| Codice | `/srv/machines-zato-app` |
| Configurazione | `/srv/machines-zato-app/.env.production` |
| File caricati | `/srv/machines-zato/uploads` |
| Log | `docker compose logs -f app` |
| Riavvio | `docker compose restart app` |
| Console DB | `sudo -u postgres psql fascicolo_macchine` |
| Script manutenzione | `docker compose run --rm tools npm run <script>` |
