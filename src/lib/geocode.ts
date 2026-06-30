import "server-only";

/**
 * Geocoding gratuito via OpenStreetMap/Nominatim (città → lat/lng).
 * Cache in-process per non ripetere chiamate. Rispettare l'uso equo:
 * poche richieste, User-Agent valorizzato.
 */

const cache = new Map<string, [number, number] | null>();

export async function geocode(
  query: string,
  countryCode?: string | null
): Promise<[number, number] | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const key = `${q}|${countryCode ?? ""}`.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", "1");
  if (countryCode && countryCode !== "XX") u.searchParams.set("countrycodes", countryCode.toLowerCase());

  try {
    const res = await fetch(u.toString(), {
      headers: {
        "user-agent": "ZATO-Fascicolo-Tecnico/1.0 (service module presence map)",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const arr = (await res.json()) as { lat?: string; lon?: string }[];
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (hit?.lat && hit?.lon) {
      const r: [number, number] = [Number(hit.lat), Number(hit.lon)];
      cache.set(key, r);
      return r;
    }
  } catch {
    // rete non disponibile / timeout → fallback al chiamante
  }
  cache.set(key, null);
  return null;
}
