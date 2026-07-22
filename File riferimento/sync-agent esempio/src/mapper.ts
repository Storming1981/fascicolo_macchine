// Mapping dei record raw da SQL Server al formato accettato dalle API del dashboard.
//
// Responsabilita':
// - Strip dei suffissi numerici dai campi dimensionali (es. "EUROPA - 130" -> "EUROPA")
//   per allinearsi al pre-processing fatto dall'importer Excel.
// - Conversione USD -> EUR per i record provenienti dal DB ZATONA usando il rate
//   mensile fornito (lookup per anno+mese).
// - Filtraggio del cliente "Zato North America" dai record ZATO (per evitare
//   double-counting con ZATONA).

import type { DbInstanceConfig } from './config';
import type { RevenueRowRaw, BacklogRowRaw } from './sqlserver';

// Tipi finali inviati alle API del dashboard.

export interface RevenuePayload {
  numeroDocumento: number | null;
  serie: string | null;
  cliente: string | null;
  prodotto: string | null;
  zonaCliente: string | null;
  gruppoProdotto: string | null;
  sottograppoProdotto: string | null;
  contropartita: number | null;
  commessa: number | null;
  categoriaCliente: string | null;
  canaleCliente: string | null;
  continenteDestinazione: string | null;
  tipologiaUtilizzatore: string | null;
  scopoFornitura: string | null;
  tipologiaFornitura: string | null;
  modelloFornitura: string | null;
  // Stato/regione (es. stato federale USA). Per ZATONA la "zona cliente" del
  // gestionale contiene lo stato: lo spostiamo qui e normalizziamo zonaCliente
  // a "STATI UNITI". NULL per ZATO e per i paesi non-USA.
  stato: string | null;
  tipoRecord: string | null;
  tipoBollaFattura: number | null;
  dataDocumento: string | null;
  mese: number;
  anno: number;
  quantitaFatturata: number | null;
  valoreFatturato: number | null;
  costoTotalePrevisto: number | null;
  margine: number | null;
  provvigioneAgente1: number | null;
  provvigioneAgente2: number | null;
  margineProvvigione: number | null;
  costoPrevisto: number | null;
  margineConsuntivo: number | null;
  source: string;
}

export interface BacklogPayload {
  serieDocumento: string | null;
  numeroDocumento: string | null;
  cliente: string | null;
  dataOrdine: string | null;
  dataConsegna: string | null;
  commessa: string | null;
  prodotto: string | null;
  gruppoProdotto: string | null;
  sottograppoProdotto: string | null;
  contropartita: string | null;
  continenteDestinazione: string | null;
  tipologiaUtilizzatore: string | null;
  scopoFornitura: string | null;
  tipologiaFornitura: string | null;
  modelloFornitura: string | null;
  tipoRecord: string | null;
  tipoBollaFattura: number | null;
  quantitaDaEvadere: number | null;
  valoreResiduo: number | null;
  provvigioneAgente1: number | null;
  source: string;
}

// ============================================================
// Helper di sanificazione
// ============================================================

function stripSuffix(val: string | null): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s.replace(/\s*-\s*\d+$/, '').trim() || null;
}

function clean(val: string | null): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

// Paesi non-USA noti per i record ZATONA: la loro "zona cliente" e' gia' un
// paese e va lasciata invariata (stato = NULL). Tutto il resto e' considerato
// uno stato USA -> Nazione diventa "STATI UNITI". Deve restare allineata alla
// lista nella migration backfill_stato_zatona.
const NON_US_ZONES = new Set(['STATI UNITI', 'USA', 'CANADA', 'MESSICO', 'MEXICO']);

/**
 * Per i record ZATONA il gestionale USA mette lo stato federale nel campo zona.
 * Restituisce { zona, stato } normalizzati: se la zona e' uno stato USA,
 * zona->"STATI UNITI" e stato->valore originale; altrimenti invariati.
 */
function splitUsState(
  source: string,
  zona: string | null
): { zona: string | null; stato: string | null } {
  if (source !== 'ZATONA' || !zona) return { zona, stato: null };
  if (NON_US_ZONES.has(zona.toUpperCase())) return { zona, stato: null };
  return { zona: 'STATI UNITI', stato: zona };
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  // SQL Server restituisce Date in UTC; usiamo solo la parte YYYY-MM-DD.
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Converte un valore in USD verso EUR usando il rate (USD per 1 EUR).
 * EUR = USD / rate. Restituisce null se il valore o il rate sono mancanti.
 */
function usdToEur(value: number | null, rate: number | null): number | null {
  if (value === null || value === undefined) return null;
  if (rate === null || rate === undefined || rate <= 0) return null;
  return value / rate;
}

/** Arrotonda a 2 decimali per evitare cumuli di rumore floating point. */
function round2(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

// ============================================================
// Mapping REVENUES
// ============================================================

export function mapRevenueRow(
  raw: RevenueRowRaw,
  db: DbInstanceConfig,
  ratesByMonth: Record<string, number>
): RevenuePayload | null {
  // Filtro: escludi il cliente an_conto specificato (es. Zato NA dal DB ZATO).
  if (
    db.excludeCustomerAnConto &&
    raw.an_conto !== null &&
    String(raw.an_conto).trim() === String(db.excludeCustomerAnConto).trim()
  ) {
    return null;
  }

  // Conversione USD -> EUR se il DB e' in USD.
  const needsConversion = db.currency === 'USD';
  const rate = needsConversion ? ratesByMonth[String(raw.mese)] ?? null : null;

  // Se serve conversione ma manca il rate, la riga viene scartata e segnalata dal chiamante.
  if (needsConversion && rate === null) {
    return null;
  }

  const conv = (v: number | null): number | null => {
    if (v === null || v === undefined) return null;
    return needsConversion ? round2(usdToEur(v, rate)) : v;
  };

  // Per ZATONA la "zona cliente" e' in realta' lo stato USA: la separiamo.
  const { zona: zonaNorm, stato } = splitUsState(db.database, stripSuffix(raw.zona_cliente));

  return {
    numeroDocumento: raw.numero_documento,
    serie: clean(raw.serie),
    cliente: clean(raw.cliente),
    prodotto: clean(raw.prodotto),
    zonaCliente: zonaNorm,
    stato,
    gruppoProdotto: stripSuffix(raw.gruppo_prodotto),
    sottograppoProdotto: stripSuffix(raw.sottogruppo_prodotto),
    contropartita: raw.contropartita,
    commessa: raw.commessa,
    categoriaCliente: stripSuffix(raw.categoria_cliente),
    canaleCliente: stripSuffix(raw.canale_cliente),
    continenteDestinazione: stripSuffix(raw.continente_destinazione),
    tipologiaUtilizzatore: stripSuffix(raw.tipologia_utilizzatore),
    scopoFornitura: stripSuffix(raw.scopo_fornitura),
    tipologiaFornitura: stripSuffix(raw.tipologia_fornitura),
    modelloFornitura: stripSuffix(raw.modello_fornitura),
    tipoRecord: clean(raw.tipo_record),
    tipoBollaFattura: raw.tipo_bolla_fattura,
    dataDocumento: toIsoDate(raw.data_documento),
    mese: raw.mese,
    anno: raw.anno,
    // La quantita NON viene convertita (e' un volume fisico, non monetario).
    quantitaFatturata: raw.quantita_fatturata,
    valoreFatturato: conv(raw.valore_fatturato),
    costoTotalePrevisto: conv(raw.costo_totale_previsto),
    margine: conv(raw.margine),
    provvigioneAgente1: conv(raw.provvigione_agente_1),
    provvigioneAgente2: conv(raw.provvigione_agente_2),
    margineProvvigione: conv(raw.margine_provvigione),
    costoPrevisto: conv(raw.costo_previsto),
    margineConsuntivo: conv(raw.margine_consuntivo),
    source: db.database,
  };
}

// ============================================================
// Mapping BACKLOG
// ============================================================

export function mapBacklogRow(
  raw: BacklogRowRaw,
  db: DbInstanceConfig,
  ratesByMonth: Record<string, number>
): BacklogPayload | null {
  // Filtro: escludi cliente Zato NA dal DB ZATO se configurato.
  if (
    db.excludeCustomerAnConto &&
    raw.an_conto !== null &&
    String(raw.an_conto).trim() === String(db.excludeCustomerAnConto).trim()
  ) {
    return null;
  }

  const needsConversion = db.currency === 'USD';
  // Per il backlog la priorita' di lookup del rate e':
  //   1. mese di data_consegna (riferimento "logico" dell'ordine)
  //   2. mese di data_ordine (fallback se la consegna e' nel futuro senza rate)
  //   3. mese corrente (snapshot date)
  //   4. ultimo rate disponibile nell'anno (rate piu' alto per chiave numerica)
  // L'ultimo fallback evita di scartare ordini con consegna futura quando
  // l'utente ha caricato solo i rate fino al mese corrente.
  let rate: number | null = null;
  if (needsConversion) {
    const candidates: number[] = [];
    if (raw.data_consegna instanceof Date) candidates.push(raw.data_consegna.getUTCMonth() + 1);
    if (raw.data_ordine instanceof Date) candidates.push(raw.data_ordine.getUTCMonth() + 1);
    candidates.push(new Date().getMonth() + 1);

    for (const m of candidates) {
      const r = ratesByMonth[String(m)];
      if (r !== undefined) {
        rate = r;
        break;
      }
    }
    // Fallback finale: prendi l'ultimo mese disponibile (massima chiave numerica)
    if (rate === null) {
      const months = Object.keys(ratesByMonth)
        .map((k) => parseInt(k, 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => b - a);
      if (months.length > 0) rate = ratesByMonth[String(months[0])];
    }
  }

  if (needsConversion && rate === null) {
    return null;
  }

  const conv = (v: number | null): number | null => {
    if (v === null || v === undefined) return null;
    return needsConversion ? round2(usdToEur(v, rate)) : v;
  };

  return {
    serieDocumento: clean(raw.serie_documento),
    numeroDocumento: clean(raw.numero_documento),
    cliente: clean(raw.cliente),
    dataOrdine: toIsoDate(raw.data_ordine),
    dataConsegna: toIsoDate(raw.data_consegna),
    commessa: clean(raw.commessa),
    prodotto: clean(raw.prodotto),
    gruppoProdotto: stripSuffix(raw.gruppo_prodotto),
    sottograppoProdotto: stripSuffix(raw.sottogruppo_prodotto),
    contropartita: clean(raw.contropartita),
    continenteDestinazione: stripSuffix(raw.continente_destinazione),
    tipologiaUtilizzatore: stripSuffix(raw.tipologia_utilizzatore),
    scopoFornitura: stripSuffix(raw.scopo_fornitura),
    tipologiaFornitura: stripSuffix(raw.tipologia_fornitura),
    modelloFornitura: stripSuffix(raw.modello_fornitura),
    tipoRecord: clean(raw.tipo_record),
    tipoBollaFattura: raw.tipo_bolla_fattura,
    // Quantita: volume fisico, non convertita.
    quantitaDaEvadere: raw.quantita_da_evadere,
    valoreResiduo: conv(raw.valore_residuo),
    provvigioneAgente1: conv(raw.provvigione_agente_1),
    source: db.database,
  };
}
