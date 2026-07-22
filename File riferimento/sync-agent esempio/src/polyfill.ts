// Polyfill per Node.js 16 (compatibilita' con Windows Server vecchi)
// fetch e' disponibile globalmente da Node 18+, da undici altrimenti
// AbortSignal.any e' disponibile da Node 20+

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

if (
  typeof AbortSignal !== 'undefined' &&
  typeof (AbortSignal as unknown as { any?: unknown }).any !== 'function'
) {
  (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any = function (
    signals: AbortSignal[]
  ): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort((signal as AbortSignal & { reason?: unknown }).reason);
        break;
      }
      signal.addEventListener(
        'abort',
        () => controller.abort((signal as AbortSignal & { reason?: unknown }).reason),
        { once: true }
      );
    }
    return controller.signal;
  };
}
