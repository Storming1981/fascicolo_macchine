// Polyfill per Node.js 16 (compatibilita' con Windows Server vecchi).
// fetch e' globale da Node 18+, altrimenti lo prendiamo da undici.

if (typeof (globalThis as { fetch?: unknown }).fetch !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as {
    fetch: typeof fetch;
    Headers: typeof Headers;
    Request: typeof Request;
    Response: typeof Response;
    FormData: typeof FormData;
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.fetch = undici.fetch;
  g.Headers = undici.Headers;
  g.Request = undici.Request;
  g.Response = undici.Response;
  if (undici.FormData) g.FormData = undici.FormData;
}
