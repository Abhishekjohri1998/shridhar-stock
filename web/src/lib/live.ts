import { useEffect, useState } from 'react';
import { hasToken, http } from './api';

export type LiveKind = 'bills' | 'stock' | 'transfers' | 'pos' | 'deliveries' | 'orders' | 'items' | 'link';

/**
 * One live stream per tab, shared by every screen on it.
 *
 * Events only say what changed; screens then re-read through the normal API. When the stream
 * drops (a phone going to sleep, the shop's internet blinking) it reconnects with a fresh ticket,
 * and every screen re-reads on reconnect, so nothing that happened meanwhile is missed.
 */
type Listener = (kind: LiveKind | 'reconnect') => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let status: 'off' | 'connecting' | 'live' = 'off';
const statusListeners = new Set<(s: typeof status) => void>();

function setStatus(s: typeof status) {
  status = s;
  statusListeners.forEach((f) => f(s));
}

async function connect() {
  if (source || !hasToken()) return;
  setStatus('connecting');
  try {
    const { ticket } = await http.post<{ ticket: string }>('/events/ticket', {});
    const es = new EventSource('/api/events?ticket=' + encodeURIComponent(ticket));
    source = es;
    es.addEventListener('hello', () => {
      setStatus('live');
      listeners.forEach((f) => f('reconnect'));
    });
    es.addEventListener('change', (e) => {
      try {
        const { kind } = JSON.parse((e as MessageEvent).data) as { kind: LiveKind };
        listeners.forEach((f) => f(kind));
      } catch {
        /* ignore a garbled event */
      }
    });
    es.onerror = () => {
      // Tickets are single-use, so the browser's own retry cannot work: start again.
      es.close();
      source = null;
      setStatus('connecting');
      scheduleRetry();
    };
  } catch {
    source = null;
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (retry || listeners.size === 0) return;
  retry = setTimeout(() => {
    retry = null;
    void connect();
  }, 3000);
}

function disconnect() {
  source?.close();
  source = null;
  if (retry) clearTimeout(retry);
  retry = null;
  setStatus('off');
}

/**
 * A number that goes up whenever one of `kinds` changes on the server (or the stream
 * reconnects). Put it in a loader's dependencies and the screen stays current by itself.
 */
export function useLive(...kinds: LiveKind[]): number {
  const [n, setN] = useState(0);
  const key = kinds.join();
  useEffect(() => {
    const f: Listener = (k) => {
      if (k === 'reconnect' || kinds.includes(k)) setN((x) => x + 1);
    };
    listeners.add(f);
    void connect();
    return () => {
      listeners.delete(f);
      if (listeners.size === 0) disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return n;
}

/** 'live' when updates are arriving, for a small dot in the corner. */
export function useLiveStatus(): 'off' | 'connecting' | 'live' {
  const [s, setS] = useState(status);
  useEffect(() => {
    statusListeners.add(setS);
    return () => {
      statusListeners.delete(setS);
    };
  }, []);
  return s;
}

/** Called on sign-out, so the stream does not outlive the session. */
export function stopLive(): void {
  disconnect();
}
