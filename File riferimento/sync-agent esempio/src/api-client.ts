// Client HTTPS per comunicare con il dashboard (finance.zatospa.it).
//
// Tre endpoint:
//   GET  /api/sync/exchange-rates?currency=USD&year=Y  -> rate per mese
//   POST /api/sync/revenues                           -> replace anno per anno
//   POST /api/sync/backlog                            -> replace per snapshotDate

import { config } from './config';
import type { RevenuePayload, BacklogPayload } from './mapper';

interface SyncResultBase {
  message?: string;
  status: 'success' | 'partial' | 'error';
  results: {
    deleted: number;
    inserted: number;
  };
  durationMs: number;
}

// ============================================================
// Fetch dei rate di cambio dal dashboard
// ============================================================

/**
 * Restituisce { '1': 1.08, '2': 1.085, ... } per i mesi che hanno un rate.
 * I mesi senza rate sono omessi dalla mappa.
 */
export async function fetchExchangeRates(
  currency: 'USD',
  year: number
): Promise<Record<string, number>> {
  const url = `${config.api.exchangeRatesUrl}?currency=${encodeURIComponent(currency)}&year=${year}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.api.key}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Errore fetch exchange-rates ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    currency: string;
    year: number;
    rates: Record<string, number>;
  };

  return data.rates ?? {};
}

// ============================================================
// Push revenues (replace per anno)
// ============================================================

export async function pushRevenues(
  revenues: RevenuePayload[],
  year: number
): Promise<SyncResultBase> {
  const response = await fetch(config.api.revenuesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.api.key}`,
    },
    body: JSON.stringify({
      revenues,
      year,
      agentInfo: config.sync.agentInfo,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Errore POST /api/sync/revenues ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<SyncResultBase>;
}

// ============================================================
// Push backlog (replace per snapshotDate)
// ============================================================

export async function pushBacklog(
  backlog: BacklogPayload[],
  snapshotDate: string
): Promise<SyncResultBase> {
  const response = await fetch(config.api.backlogUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.api.key}`,
    },
    body: JSON.stringify({
      backlog,
      snapshotDate,
      agentInfo: config.sync.agentInfo,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Errore POST /api/sync/backlog ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<SyncResultBase>;
}
