/**
 * URL assoluto verso una pagina dell'app, ricavato dagli header del proxy.
 *
 * Dietro al reverse proxy `new URL(path, req.url)` NON va bene: in build
 * standalone Next vede l'indirizzo di ascolto del container e l'utente finisce
 * su `https://0.0.0.0:3000/...` (ERR_ADDRESS_INVALID). È successo al ritorno dal
 * consenso Google: il collegamento riusciva, ma la pagina finale non si apriva.
 */
const first = (v: string | null): string | null => v?.split(",")[0]?.trim() || null;

export function absoluteUrl(req: Request, path: string): string {
  const h = req.headers;
  const proto = first(h.get("x-forwarded-proto")) || "https";
  const host = first(h.get("x-forwarded-host")) || h.get("host") || "localhost";
  return `${proto}://${host}${path}`;
}
