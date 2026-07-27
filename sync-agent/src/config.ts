// Configurazione del sync-agent ERP, da variabili d'ambiente (.env).

function resolveBaseUrl(): string {
  const base = process.env.SYNC_API_BASE_URL || '';
  return base.replace(/\/+$/, '');
}

const baseUrl = resolveBaseUrl();

export const config = {
  api: {
    baseUrl,
    // Endpoint sull'app (VPS)
    machinesUrl: `${baseUrl}/api/sync/erp/machines`,
    pushUrl: `${baseUrl}/api/sync/erp`,
    articlesUrl: `${baseUrl}/api/sync/erp/articles`,
    key: process.env.SYNC_API_KEY || '',
  },
  sqlserver: {
    server: process.env.SQLSERVER_HOST || '192.168.1.144',
    port: parseInt(process.env.SQLSERVER_PORT || '1433', 10),
    user: process.env.SQLSERVER_USER || '',
    password: process.env.SQLSERVER_PASSWORD || '',
    database: process.env.SQLSERVER_DATABASE || 'ZATO',
    options: {
      encrypt: process.env.SQLSERVER_ENCRYPT === 'true',
      trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== 'false',
      enableArithAbort: true,
      connectTimeout: 15000,
      requestTimeout: 60000,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 10000 },
  },
  sync: {
    agentInfo: process.env.AGENT_INFO || 'machines-zato-erp-sync-agent',
    // Quanti fascicoli per ogni POST verso la VPS (evita payload enormi).
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE || '50', 10),
    // Concorrenza delle query ERP (quante commesse in parallelo).
    concurrency: parseInt(process.env.SYNC_CONCURRENCY || '4', 10),
    // Articoli per ogni POST del catalogo ricambi.
    articlesBatchSize: parseInt(process.env.SYNC_ARTICLES_BATCH || '1000', 10),
  },
};

export function validateConfig(): void {
  if (!config.api.baseUrl) {
    throw new Error('SYNC_API_BASE_URL non configurato (es. https://machines.zatospa.it)');
  }
  if (!config.api.key) {
    throw new Error('SYNC_API_KEY non configurato');
  }
  if (!config.api.key.startsWith('sk_sync_')) {
    throw new Error('SYNC_API_KEY non valida (deve iniziare con "sk_sync_")');
  }
  if (!config.sqlserver.server) {
    throw new Error('SQLSERVER_HOST non configurato');
  }
  if (!config.sqlserver.user || !config.sqlserver.password) {
    throw new Error('SQLSERVER_USER / SQLSERVER_PASSWORD non configurati');
  }
}
