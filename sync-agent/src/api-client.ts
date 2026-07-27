// Client HTTPS verso l'app (machines.zatospa.it).
//
//   GET  /api/sync/erp/machines  -> lista fascicoli con le chiavi da interrogare
//   POST /api/sync/erp           -> invia i dati ERP calcolati per i fascicoli

import { config } from './config';

export interface MachineRow {
  id: string;
  code: string;
  job: string | null;
  jobBody: string | null;
  jobContainer: string | null;
  erpBodyOrder: string | null;
  erpContainerOrder: string | null;
  erpStandOrder: string | null;
  erpBladesOrder: string | null;
}

export interface PushResult {
  id: string;
  found: boolean;
  customer?: string | null;
  customerCountryIso?: string | null;
  customerCountryName?: string | null;
  description?: string | null;
  totalHours?: number | null;
  productionStart?: string | null;
  productionEnd?: string | null;
}

export interface PushResponse {
  status: 'success' | 'partial';
  results: {
    received: number;
    matched: number;
    updated: number;
    withProduction: number;
    errorCount: number;
  };
  errors: { id: string; error: string }[];
  durationMs: number;
}

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${config.api.key}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export async function fetchMachines(): Promise<MachineRow[]> {
  const res = await fetch(config.api.machinesUrl, { method: 'GET', headers: authHeaders() });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GET /api/sync/erp/machines ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { count: number; machines: MachineRow[] };
  return data.machines ?? [];
}

export async function pushResults(
  results: PushResult[],
  options?: Record<string, boolean>,
): Promise<PushResponse> {
  const res = await fetch(config.api.pushUrl, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ results, options, agentInfo: config.sync.agentInfo }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`POST /api/sync/erp ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json() as Promise<PushResponse>;
}

export interface ArticlesPushResponse {
  status: string;
  received: number;
  inserted: number;
  totalInCatalog: number;
}

export async function pushArticles(
  articles: { code: string; description: string }[],
  replace: boolean,
): Promise<ArticlesPushResponse> {
  const res = await fetch(config.api.articlesUrl, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ articles, replace }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`POST /api/sync/erp/articles ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json() as Promise<ArticlesPushResponse>;
}
