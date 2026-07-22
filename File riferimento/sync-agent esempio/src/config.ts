// Configurazione del sync agent caricata da variabili d'ambiente.
//
// Connessione SQL Server: stessa host/port/user/password per i due DB.
// I database (ZATO e ZATONA) sono nomi distinti sullo stesso server.

export interface DbInstanceConfig {
  /** Nome del database SQL Server (es. 'ZATO' o 'ZATONA') */
  database: string;
  /** Codice ditta nel filtro WHERE dwarehe.codditt = ? (di solito uguale a database) */
  codditt: string;
  /** Etichetta valuta dei valori (per applicare la conversione, 'EUR' = nessuna conversione) */
  currency: 'EUR' | 'USD';
  /**
   * Codice anagrafica (an_conto) da escludere come cliente.
   * Per ZATO: codice di "Zato North America" per evitare double-counting con ZATONA.
   * Null o vuoto = nessuna esclusione.
   */
  excludeCustomerAnConto?: string | null;
  /**
   * Lista di valori `dw_serie` (o `serie_documento` lato backlog) da escludere
   * dal sync backlog (es. ordini intercompany dove Zato e' cliente di se stesso).
   * Per ZATO: tipicamente ['Z']. Array vuoto = nessuna esclusione.
   */
  excludeBacklogSeries?: string[];
}

function resolveBaseUrl(): string {
  const base = process.env.SYNC_API_BASE_URL || '';
  return base.replace(/\/+$/, '');
}

const baseUrl = resolveBaseUrl();

function parseSeriesList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDbList(): DbInstanceConfig[] {
  // DB 1: ZATO (default)
  const db1: DbInstanceConfig = {
    database: process.env.SQLSERVER_DATABASE_ZATO || 'ZATO',
    codditt: process.env.SQLSERVER_CODDITT_ZATO || 'ZATO',
    currency: 'EUR',
    excludeCustomerAnConto: process.env.ZATO_EXCLUDE_AN_CONTO || null,
    // Esclude ordini intercompany (es. serie='Z' per Zato cliente di se stessa).
    // Default: 'Z'. Override via env ZATO_BACKLOG_EXCLUDE_SERIE='Z,X,Y'.
    excludeBacklogSeries: parseSeriesList(
      process.env.ZATO_BACKLOG_EXCLUDE_SERIE ?? 'Z'
    ),
  };
  // DB 2: ZATONA (USD, da convertire)
  const db2: DbInstanceConfig = {
    database: process.env.SQLSERVER_DATABASE_ZATONA || 'ZATONA',
    codditt: process.env.SQLSERVER_CODDITT_ZATONA || 'ZATONA',
    currency: 'USD',
    // Codice an_conto del cliente "Zato SPA" nel DB ZATONA da escludere
    // (intercompany: vendite di Zato NA verso Zato SPA). Lascia vuoto per non filtrare.
    excludeCustomerAnConto: process.env.ZATONA_EXCLUDE_AN_CONTO || null,
    excludeBacklogSeries: parseSeriesList(process.env.ZATONA_BACKLOG_EXCLUDE_SERIE),
  };
  return [db1, db2];
}

export const config = {
  api: {
    baseUrl,
    revenuesUrl: `${baseUrl}/api/sync/revenues`,
    backlogUrl: `${baseUrl}/api/sync/backlog`,
    exchangeRatesUrl: `${baseUrl}/api/sync/exchange-rates`,
    key: process.env.SYNC_API_KEY || '',
  },
  sqlserver: {
    server: process.env.SQLSERVER_HOST || '192.168.1.144',
    port: parseInt(process.env.SQLSERVER_PORT || '1433'),
    user: process.env.SQLSERVER_USER || 'sa',
    password: process.env.SQLSERVER_PASSWORD || '',
    options: {
      encrypt: process.env.SQLSERVER_ENCRYPT === 'true',
      trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== 'false',
      enableArithAbort: true,
      connectTimeout: 15000,
      requestTimeout: 300000, // 5 minuti per query pesanti su anno intero
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 10000,
    },
  },
  databases: parseDbList(),
  sync: {
    agentInfo: process.env.AGENT_INFO || 'zato-dashboard-sync-agent',
    // Scenario di filtro nel WHERE: 2002 per backlog, 2001/altri per revenues (configurabile)
    revenuesScenario: parseInt(process.env.REVENUES_SCENARIO || '2002', 10),
    backlogScenario: parseInt(process.env.BACKLOG_SCENARIO || '2002', 10),
    backlogFromDate: process.env.BACKLOG_FROM_DATE || '2022-01-01',
    // Tipi di record (dw_tipork) inclusi nel sync revenues. Default = A,B,D,N:
    //   A = Fatture immediate emesse
    //   B = DDT emessi
    //   D = Fatture differite emesse
    //   N = Note di credito emesse
    // Esclude H (ord. produzione), O (ord. fornitore), R (impegno cliente),
    // Y (impegno produzione).
    revenuesTipiRecord: parseSeriesList(process.env.REVENUES_TIPI_RECORD ?? 'A,B,D,N'),
    // Tipi di record inclusi nel sync backlog. Default = R (Impegno cliente).
    // Esclude H (ord. produzione), O (ord. fornitore), Y (impegno produzione).
    backlogTipiRecord: parseSeriesList(process.env.BACKLOG_TIPI_RECORD ?? 'R'),
    // Valori ammessi di testord.td_tipobf (Tipo Bolla/Fattura) per il backlog.
    // Default = 1 (ordini standard da fatturare). Esclude p.es. 0 = garanzia,
    // che NON deve essere conteggiata nel backlog di fatturato.
    backlogTipiBollaFattura: parseSeriesList(process.env.BACKLOG_TIPI_BF ?? '1'),
    // Valori ammessi di movord.mo_flevas (flag stato evasione) per il backlog.
    // Default = C (in corso / ancora da evadere). Esclude S (totalmente evaso).
    // Se vuoi includere anche le righe parziali, aggiungi 'P' (es. 'C,P').
    backlogFlevas: parseSeriesList(process.env.BACKLOG_FLEVAS ?? 'C'),
  },
};

export function validateConfig(): void {
  if (!config.api.baseUrl) {
    throw new Error('SYNC_API_BASE_URL non configurato (es. https://finance.zatospa.it)');
  }
  if (!config.api.key) {
    throw new Error('SYNC_API_KEY non configurato');
  }
  if (!config.api.key.startsWith('sk_sync_')) {
    throw new Error('SYNC_API_KEY non valida (deve iniziare con "sk_sync_")');
  }
  if (!config.sqlserver.password) {
    throw new Error('SQLSERVER_PASSWORD non configurato');
  }
}
