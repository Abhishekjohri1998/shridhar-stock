import { env } from './env';

/**
 * The address search behind the delivery pin: OpenStreetMap's Nominatim, asked only through the
 * server so that its usage policy holds for the whole shop at once:
 *   - at most one request a second (calls wait their turn in a queue);
 *   - a User-Agent that says who is asking;
 *   - answers kept, so the same search never goes out twice in a day.
 */
export interface Place {
  name: string;
  lat: number;
  lng: number;
}

type FetchFn = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GeocoderOptions {
  fetch?: FetchFn;
  baseUrl?: string;
  userAgent?: string;
  /** The least time between two requests to Nominatim. */
  gapMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const GEOCODE_USER_AGENT = 'ShridharStock/0.1 (shop deliveries' + (env.geocodeContact ? '; ' + env.geocodeContact : '') + ')';

/** "  MG Road,  Bangalore " and "mg road, bangalore" are the same search. */
export const geocodeKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export function createGeocoder(o: GeocoderOptions = {}) {
  const doFetch: FetchFn = o.fetch ?? ((url, init) => fetch(url, init));
  const base = (o.baseUrl ?? env.geocodeUrl).replace(/\/+$/, '');
  const ua = o.userAgent ?? GEOCODE_USER_AGENT;
  const gap = o.gapMs ?? 1000;
  const ttl = o.ttlMs ?? 24 * 3600_000;
  const max = o.maxEntries ?? 500;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const cache = new Map<string, { at: number; places: Place[] }>();
  const inFlight = new Map<string, Promise<Place[]>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastCall = -Infinity;
  let upstreamCalls = 0;

  async function ask(q: string): Promise<Place[]> {
    const wait = lastCall + gap - now();
    if (wait > 0) await sleep(wait);
    lastCall = now();
    upstreamCalls++;
    const url = base + '/search?format=jsonv2&limit=5&countrycodes=in&addressdetails=0&q=' + encodeURIComponent(q);
    const res = await doFetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json', 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error('The address search answered ' + res.status);
    const body = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    return (Array.isArray(body) ? body : [])
      .map((r) => ({ name: String(r.display_name ?? ''), lat: Number(r.lat), lng: Number(r.lon) }))
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  async function search(raw: string): Promise<Place[]> {
    const key = geocodeKey(raw);
    if (key.length < 3) return [];
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.places;
    const running = inFlight.get(key);
    if (running) return running;
    // One at a time, a second apart, whoever asks.
    const p = queue.then(() => ask(key));
    queue = p.catch(() => undefined);
    inFlight.set(key, p);
    try {
      const places = await p;
      cache.set(key, { at: now(), places });
      while (cache.size > max) cache.delete(cache.keys().next().value!);
      return places;
    } finally {
      inFlight.delete(key);
    }
  }

  return { search, stats: () => ({ upstreamCalls, cached: cache.size }) };
}

let shared: ReturnType<typeof createGeocoder> | null = null;
export function geocoder(): ReturnType<typeof createGeocoder> {
  return (shared ??= createGeocoder());
}
