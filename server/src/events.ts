import type { Response } from 'express';
import type { Role } from '@stock/core';
import type { PersonRecord } from './store/types';

/**
 * Live updates: one server-sent-events stream per open screen.
 *
 * An event says only what changed ("bills", "transfer tr_3"), never the data: the screen reads
 * it again through the normal, role-checked API. So a stream can never show anyone more than
 * they could read anyway, and a missed event costs nothing but a moment's staleness (every
 * screen also re-reads when its stream reconnects).
 *
 * The server is one process, so the hub is a set in memory.
 */
export type EventKind = 'bills' | 'stock' | 'transfers' | 'pos' | 'items' | 'link' | 'low';

/** Who an event is for. Absent fields mean "not narrowed by this". */
export interface Audience {
  roles?: Role[];
  locationIds?: string[];
  personId?: string;
}

interface Client {
  res: Response;
  person: PersonRecord;
}

const clients = new Set<Client>();

function wants(p: PersonRecord, a: Audience): boolean {
  if (p.role === 'admin') return true;
  if (a.roles && !a.roles.includes(p.role)) return false;
  if (p.role === 'godown' && a.locationIds && !a.locationIds.includes(p.linkedId ?? '')) return false;
  return true;
}

/** Who each kind of change matters to, before narrowing by place, supplier or person. */
const DEFAULT_ROLES: Record<EventKind, Role[]> = {
  bills: ['worker'],
  stock: ['godown'],
  transfers: ['godown'],
  pos: [],
  items: ['worker', 'godown'],
  link: [],
  // An item going below its level: the admin's screens only.
  low: [],
};

const emitHooks = new Set<(kind: EventKind) => void>();
/** Runs on every event, before it goes out: what server-side caches use to drop stale answers. */
export function onEmit(fn: (kind: EventKind) => void): () => void {
  emitHooks.add(fn);
  return () => emitHooks.delete(fn);
}

export function emit(kind: EventKind, audience: Audience = {}, id?: string): void {
  for (const fn of emitHooks) fn(kind);
  const a = { roles: DEFAULT_ROLES[kind], ...audience };
  const line = 'event: change\ndata: ' + JSON.stringify({ kind, ...(id ? { id } : {}) }) + '\n\n';
  for (const c of clients) {
    if (!wants(c.person, a)) continue;
    try {
      c.res.write(line);
    } catch {
      clients.delete(c);
    }
  }
}

export function subscribe(person: PersonRecord, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Caddy and other proxies must pass each event straight on, not hold it in a buffer.
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write('event: hello\ndata: {}\n\n');
  const c: Client = { res, person };
  clients.add(c);
  const beat = setInterval(() => {
    try {
      res.write(': beat\n\n');
    } catch {
      /* closed */
    }
  }, 25_000);
  res.on('close', () => {
    clearInterval(beat);
    clients.delete(c);
  });
}

export function listenerCount(): number {
  return clients.size;
}

/** Signs everyone of a person out of the stream (PIN reset, switched off). */
export function dropPerson(personId: string): void {
  for (const c of clients) {
    if (c.person.id === personId) {
      c.res.end();
      clients.delete(c);
    }
  }
}
