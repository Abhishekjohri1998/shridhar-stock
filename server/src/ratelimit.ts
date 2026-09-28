/**
 * Locks a login after too many wrong PINs.
 *
 * Keyed by address and phone together, so one person mistyping does not lock everyone behind the
 * shop's single internet connection, and one address cannot try every phone number either (the
 * address alone gets a looser limit). In memory: the server is one process, and a restart
 * forgetting the count is acceptable.
 */
const MAX_FAILS = 5;
const MAX_FAILS_PER_ADDRESS = 30;
const LOCK_MS = 15 * 60 * 1000;

interface Entry {
  fails: number;
  until: number;
}
const byKey = new Map<string, Entry>();

function entry(key: string, now: number): Entry {
  let e = byKey.get(key);
  if (!e || (e.until && e.until <= now)) {
    e = { fails: 0, until: 0 };
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

/** For the tests. */
export function resetLimits(): void {
  byKey.clear();
}
