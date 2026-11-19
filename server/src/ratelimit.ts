/**
 * Locks a login after too many wrong PINs.
 *
 * Keyed by address and phone together, so one person mistyping does not lock everyone behind the
 * shop's single internet connection, and one address cannot try every phone number either (the
 * address alone gets a looser limit). In memory: the server is one process, and a restart
 * forgetting the count is acceptable.
 *
 * Wrong tries only count against each other within WINDOW_MS of the first one. Without that, a
 * slip today and another next month would add up, and the shop's one address would creep towards
 * its limit over weeks of ordinary mistyping until every login from the shop was locked.
 */
const MAX_FAILS = 5;
const MAX_FAILS_PER_ADDRESS = 30;
const LOCK_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  fails: number;
  /** When the first of these `fails` happened. */
  since: number;
  until: number;
}
const byKey = new Map<string, Entry>();

function entry(key: string, now: number): Entry {
  let e = byKey.get(key);
  const lockOver = e != null && e.until > 0 && e.until <= now;
  const windowOver = e != null && e.until === 0 && now - e.since >= WINDOW_MS;
  if (!e || lockOver || windowOver) {
    e = { fails: 0, since: now, until: 0 };
    byKey.set(key, e);
  }
  return e;
}

/** Milliseconds left on a lock, or 0 when a try is allowed. */
export function lockedFor(ip: string, phone: string, now = Date.now()): number {
  const a = entry('p:' + ip + '|' + phone, now);
  const b = entry('a:' + ip, now);
  return Math.max(a.until > now ? a.until - now : 0, b.until > now ? b.until - now : 0);
}

export function recordFailure(ip: string, phone: string, now = Date.now()): void {
  prune(now);
  const a = entry('p:' + ip + '|' + phone, now);
  a.fails++;
  if (a.fails >= MAX_FAILS) a.until = now + LOCK_MS;
  const b = entry('a:' + ip, now);
  b.fails++;
  if (b.fails >= MAX_FAILS_PER_ADDRESS) b.until = now + LOCK_MS;
}

export function recordSuccess(ip: string, phone: string): void {
  byKey.delete('p:' + ip + '|' + phone);
}

/** Drops finished entries now and then, so the map cannot grow with every address ever seen. */
let lastPrune = 0;
function prune(now: number): void {
  if (now - lastPrune < WINDOW_MS) return;
  lastPrune = now;
  for (const [key, e] of byKey) {
    if (e.until > 0 ? e.until <= now : now - e.since >= WINDOW_MS) byKey.delete(key);
  }
}

/** For the tests. */
export function resetLimits(): void {
  byKey.clear();
}
