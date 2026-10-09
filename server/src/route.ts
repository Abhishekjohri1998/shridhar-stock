import { env } from './env';
import { GEOCODE_USER_AGENT } from './geocode';

/**
 * The road from a worker on the way to the home: the public OSRM demo server, asked only through
 * the server and politely, like the address search (see geocode.ts):
 *   - at most one request a second (calls wait their turn in a queue);
 *   - answers kept for a while, keyed by both ends rounded to ~100 m, so the live page asking
 *     every 30 s for a worker standing at a signal costs nothing;
 *   - a short timeout, and any failure is simply "no road" (null): the map then shows no route.
 */
export interface LatLng {
  lat: number;
  lng: number;
}
export interface RoadRoute {
  points: LatLng[];
  km: number;
  minutes: number;
}

type FetchFn = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RouterOptions {
  fetch?: FetchFn;
  baseUrl?: string;
  userAgent?: string;
  gapMs?: number;
  ttlMs?: number;
  timeoutMs?: number;
  maxEntries?: number;
  maxPoints?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** About 100 m: close enough that the road ahead is the same. */
export const routeKey = (a: LatLng, b: LatLng) => [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(3)).join(',');

/** Keep the first and last point and an even spread between, at most `max` in all. */
export function downsample<T>(pts: T[], max: number): T[] {
  if (pts.length <= max || max < 2) return pts;
  const out: T[] = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]!);
  return out;
}

export function createRouter(o: RouterOptions = {}) {
  const doFetch: FetchFn = o.fetch ?? ((url, init) => fetch(url, init));
  const base = (o.baseUrl ?? env.routeUrl).replace(/\/+$/, '');
  const ua = o.userAgent ?? GEOCODE_USER_AGENT;
  const gap = o.gapMs ?? 1000;
  const ttl = o.ttlMs ?? 10 * 60_000;
  const timeout = o.timeoutMs ?? 6000;
  const max = o.maxEntries ?? 300;
  const maxPoints = o.maxPoints ?? 300;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const cache = new Map<string, { at: number; route: RoadRoute | null }>();
  const inFlight = new Map<string, Promise<RoadRoute | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastCall = -Infinity;
  let upstreamCalls = 0;

  async function ask(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
    const wait = lastCall + gap - now();
    if (wait > 0) await sleep(wait);
    lastCall = now();
    upstreamCalls++;
    const url = base + '/route/v1/driving/' + from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat + '?overview=full&geometries=geojson';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: ctl.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { code?: string; routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }[] };
      const r = body?.code === 'Ok' ? body.routes?.[0] : undefined;
      const coords = r?.geometry?.coordinates;
      if (!r || !Array.isArray(coords) || coords.length < 2) return null;
      const points = coords
        .map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (points.length < 2) return null;
      return {
        points: downsample(points, maxPoints),
        km: Math.round((Number(r.distance) || 0) / 100) / 10,
        minutes: Math.max(1, Math.round((Number(r.duration) || 0) / 60)),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function route(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
    const key = routeKey(from, to);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.route;
    const running = inFlight.get(key);
    if (running) return running;
    const p = queue.then(() => ask(from, to));
    queue = p.catch(() => undefined);
    inFlight.set(key, p);
    try {
      const r = await p;
      // A failure is kept only briefly, so a server that was down is asked again soon.
      cache.set(key, { at: r ? now() : now() - ttl + 60_000, route: r });
      while (cache.size > max) cache.delete(cache.keys().next().value!);
      return r;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  }

  return { route, stats: () => ({ upstreamCalls, cached: cache.size }) };
}

let shared: ReturnType<typeof createRouter> | null = null;
export function roadRouter(): ReturnType<typeof createRouter> {
  return (shared ??= createRouter());
}
