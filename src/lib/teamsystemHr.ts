// ============================================================
//  TEAMSYSTEM HR — client delle API (anagrafica, formazione, documenti).
//
//  COME SI ENTRA. OAuth2 «client credentials» su `<url>/connect/token` con
//  scope `tshrapi.bi`; ogni chiamata porta il token e l'intestazione
//  `x-tghr-api-customer` col codice cliente (02D00). Stesso connettore della
//  nota spese nell'app produzione. L'OpenAPI (`/v3/api-docs`) mostra i
//  percorsi solo da autenticati.
//
//  DUE FAMIGLIE DI API:
//   - «BI» (`anagrafica`, `formazione`, …): ASINCRONE. `generateRequest`
//     restituisce un requestId, poi `getItems` risponde `code: 202 "Accepted,
//     still ongoing"` finché l'estrazione non è pronta: va ripetuta.
//   - documenti (`documents/mine/*`): la persona si indica con l'intestazione
//     `fiscal-code`. `getLatestFiles` restituisce solo gli ULTIMI file,
//     `numberOfFiles` al massimo 30 (31+ → 400 "Wrong numberOfFiles value").
//     Il fascicolo contiene anche cedolini e CU: il filtro sta in tecniciDocs.ts.
//
//  Niente `server-only`: lo usa anche lo script `teamsystem:link`.
// ============================================================

const cfg = () => ({
  url: (process.env.TEAMSYSTEM_HR_URL || "https://api-ext.teamsystemhr.com").replace(/\/$/, ""),
  id: process.env.TEAMSYSTEM_HR_CLIENT_ID ?? "",
  secret: process.env.TEAMSYSTEM_HR_CLIENT_SECRET ?? "",
  customer: process.env.TEAMSYSTEM_HR_CUSTOMER ?? "",
});

export function teamsystemConfigured(): boolean {
  const c = cfg();
  return !!(c.id && c.secret && c.customer);
}

/** Massimo accettato da getLatestFiles. */
export const TS_MAX_FILES = 30;

let token: { value: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const c = cfg();
  const r = await fetch(`${c.url}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.id,
      client_secret: c.secret,
      scope: "tshrapi.bi",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token)
    throw new Error(`accesso a TeamSystem HR rifiutato (${r.status} ${j.error ?? ""})`.trim());
  token = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    authorization: `Bearer ${await getToken()}`,
    "x-tghr-api-customer": cfg().customer,
    ...extra,
  };
}

// ------------------------------------------------------------
//  API «BI» asincrone
// ------------------------------------------------------------

type BiFilter = { field: string; op: string; value?: string; secondValue?: string; values?: string[] };

async function biItems<T>(entity: string, fields: string[], filters: BiFilter[] = []): Promise<T[]> {
  const c = cfg();
  const g = await fetch(`${c.url}/v1/${entity}/generateRequest`, {
    method: "POST",
    headers: await headers({ "content-type": "application/json" }),
    body: JSON.stringify({ numRecord: 500, fields, filters }),
    signal: AbortSignal.timeout(20_000),
  });
  const gj = (await g.json().catch(() => ({}))) as { requestId?: string; message?: string };
  if (!g.ok || !gj.requestId) throw new Error(`TeamSystem HR, ${entity}: ${gj.message ?? g.status}`);

  const out: T[] = [];
  const deadline = Date.now() + 60_000;
  for (let page = 1; ; ) {
    const r = await fetch(`${c.url}/v1/${entity}/getItems`, {
      method: "POST",
      headers: await headers({ "content-type": "application/json" }),
      body: JSON.stringify({ requestId: gj.requestId, numPage: page }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as {
      success?: boolean;
      code?: number;
      message?: string;
      items?: T[];
      totalPages?: string;
    };
    if (!r.ok || !j.success) throw new Error(`TeamSystem HR, ${entity}: ${j.message ?? r.status}`);
    if (j.code === 202) {
      // estrazione ancora in corso lato TeamSystem
      if (Date.now() > deadline) throw new Error(`TeamSystem HR, ${entity}: estrazione troppo lenta`);
      await new Promise((z) => setTimeout(z, 1500));
      continue;
    }
    out.push(...(j.items ?? []));
    if (page >= Number(j.totalPages || 1)) return out;
    page++;
  }
}

/** Cache in memoria di mezz'ora: anagrafica e corsi cambiano di rado. */
function cached<T>(ttlMs: number, load: () => Promise<T>) {
  let value: { at: number; data: T } | null = null;
  let pending: Promise<T> | null = null;
  return async (force = false): Promise<T> => {
    if (!force && value && Date.now() - value.at < ttlMs) return value.data;
    if (pending) return pending;
    pending = load()
      .then((data) => {
        value = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

export interface TsPerson {
  personId: string; // ID_PERSON, es. 02D00_37
  surname: string;
  name: string;
  fiscalCode: string;
  payrollId: string; // ID_PAYROLL = matricola (coincide quasi sempre col timbratore)
  ceased: boolean;
}

export const tsPeople = cached(30 * 60_000, async (): Promise<TsPerson[]> => {
  type Row = {
    ID_PERSON?: string;
    COGNOME?: string;
    NOME?: string;
    CODICE_FISCALE?: string;
    ID_PAYROLL?: string;
    DATA_CESSAZIONE?: string | null;
  };
  const rows = await biItems<Row>("anagrafica", [
    "ID_PERSON",
    "COGNOME",
    "NOME",
    "CODICE_FISCALE",
    "ID_PAYROLL",
    "DATA_CESSAZIONE",
  ]);
  return rows
    .filter((r) => r.ID_PERSON)
    .map((r) => ({
      personId: String(r.ID_PERSON),
      surname: (r.COGNOME ?? "").trim(),
      name: (r.NOME ?? "").trim(),
      fiscalCode: (r.CODICE_FISCALE ?? "").trim().toUpperCase(),
      payrollId: (r.ID_PAYROLL ?? "").trim(),
      ceased: !!r.DATA_CESSAZIONE,
    }));
});

export interface TsCourse {
  personId: string;
  code: string;
  name: string;
  area: string; // FILONE (SAFETY, …)
  status: string;
  start: string | null; // ISO yyyy-mm-dd
  end: string | null;
  hours: number | null;
}

/** "16/09/2025 00:00:00" → "2025-09-16" */
function tsDate(v: string | null | undefined): string | null {
  const m = (v ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = (v ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

/** Tutta la formazione aziendale (poche centinaia di righe): si filtra per persona. */
export const tsCourses = cached(30 * 60_000, async (): Promise<TsCourse[]> => {
  type Row = {
    ID_PERSON?: string;
    CODICE_CORSO?: string;
    NOME_CORSO?: string;
    FILONE?: string;
    STATO?: string;
    DATA_INIZIO?: string;
    DATA_FINE?: string;
    ORE_CONSUNTIVATE?: number;
    ORE_PREVISTE?: number;
  };
  const rows = await biItems<Row>("formazione", [
    "ID_PERSON",
    "CODICE_CORSO",
    "NOME_CORSO",
    "FILONE",
    "STATO",
    "DATA_INIZIO",
    "DATA_FINE",
    "ORE_CONSUNTIVATE",
    "ORE_PREVISTE",
  ]);
  return rows
    .filter((r) => r.ID_PERSON)
    .map((r) => ({
      personId: String(r.ID_PERSON),
      code: (r.CODICE_CORSO ?? "").trim(),
      name: (r.NOME_CORSO ?? "").trim(),
      area: (r.FILONE ?? "").trim(),
      status: (r.STATO ?? "").trim(),
      start: tsDate(r.DATA_INIZIO),
      end: tsDate(r.DATA_FINE),
      hours: r.ORE_CONSUNTIVATE || r.ORE_PREVISTE || null,
    }));
});

// ------------------------------------------------------------
//  Documenti
// ------------------------------------------------------------

export interface TsFile {
  uuidDocumento: string;
  nomeFile?: string;
  titolo?: string;
  cartella?: string;
  percorsoFile?: string;
  sorgente?: string;
  tipoDocumento?: string;
  dataCaricamento?: string;
}

export async function tsLatestFiles(fiscalCode: string): Promise<TsFile[]> {
  const r = await fetch(`${cfg().url}/v1/documents/mine/getLatestFiles?numberOfFiles=${TS_MAX_FILES}`, {
    headers: await headers({ "fiscal-code": fiscalCode }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string; files?: TsFile[] | null };
  if (!r.ok || !j.success) throw new Error(`TeamSystem HR, documenti: ${j.message ?? r.status}`);
  return (j.files ?? []).filter((f) => f.uuidDocumento);
}

/** Scarica il file: la risposta passa così com'è (stream) al chiamante. */
export async function tsDownload(fiscalCode: string, uuid: string): Promise<Response> {
  return fetch(`${cfg().url}/v1/documents/mine/downloadFile/${encodeURIComponent(uuid)}`, {
    headers: await headers({ "fiscal-code": fiscalCode }),
    signal: AbortSignal.timeout(60_000),
  });
}
