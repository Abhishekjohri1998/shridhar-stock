import { useEffect, useRef, useState } from 'react';
import { hasToken, http } from './api';

export type LiveKind = 'bills' | 'stock' | 'transfers' | 'pos' | 'items' | 'link' | 'low' | 'delivery';

/**
 * One live stream per tab, shared by every screen on it.
 *
 * Events only say what changed; screens then re-read through the normal API. When the stream
 * drops (a phone going to sleep, the shop's internet blinking) it reconnects with a fresh ticket,
 * and every screen re-reads on reconnect, so nothing that happened meanwhile is missed.
 */
type Listener = (kind: LiveKind | 'reconnect', id?: string, what?: string) => void;
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
        const { kind, id, what } = JSON.parse((e as MessageEvent).data) as { kind: LiveKind; id?: string; what?: string };
        listeners.forEach((f) => f(kind, id, what));
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

/**
 * `n` (a useLive number), passed on at most once every `ms`: a burst of events at a busy counter
 * becomes one re-read now and one when it settles, never one per event.
 */
export function useSettled(n: number, ms = 2000): number {
  const [out, setOut] = useState(n);
  const last = useRef(0);
  useEffect(() => {
    if (n === out) return;
    const go = () => {
      last.current = Date.now();
      setOut(n);
    };
    const wait = last.current + ms - Date.now();
    if (wait <= 0) return go();
    const t = setTimeout(go, wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return out;
}

/** Calls `fn` with the id of each `kind` event as it arrives, for a toast rather than a re-read. */
export function useLiveEvent(kind: LiveKind, fn: (id: string, what?: string) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const f: Listener = (k, id, what) => {
      if (k === kind && id) ref.current(id, what);
    };
    listeners.add(f);
    void connect();
    return () => {
      listeners.delete(f);
      if (listeners.size === 0) disconnect();
    };
  }, [kind]);
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
