import { env } from '../env';
import { getRepo } from '../store';
import { billingClient, type BillingClient } from './client';
import { emit } from '../events';
import { pushGiven } from './push';
import { backfillMoreInk, syncCustomers, pollDelay, recordLink, syncOnce, POLL_ACTIVE_WINDOW_MS, type SyncResult } from './sync';

let running: Promise<SyncResult | null> | null = null;
let last: SyncResult | null = null;
/** When a read last brought something new: keeps the quick polling going while the counter is busy. */
let lastChangeAt = 0;
/** When the last full read (the latest 30, for cancels and edits) was made. */
let lastFullAt = 0;
/** A full read this often; between them only new bills are asked for. */
export const FULL_EVERY_MS = 2 * 60_000;
/** Whether billing answers the light list: unknown until the first bills come back. */
let liteServer: boolean | null = null;
/** Older bills' further handwriting (moreInk) read again once; set when none are left. */
let backfilled = false;

export const linkConfigured = () => !!(env.billingUrl && env.billingPin);

let shared: BillingClient | null = null;
/** One signed-in client for reads and pushes alike, so its token is reused, not fetched per read. */
export function billing(): BillingClient {
  shared ??= billingClient(env.billingUrl, env.billingPin);
  return shared;
}

/** One sync, never two at once: a slow billing server must not pile runs up. */
export function syncNow(force = false): Promise<SyncResult | null> {
  if (!linkConfigured()) return Promise.resolve(null);
  if (running) return running;
  const repo = getRepo();
  running = (async () => {
    const [newest] = await repo.listDocs<{ id: string; no: number }>('bills', { sort: { no: -1 }, limit: 1, fields: ['no'] });
    // An older billing server has no light list: its latest 100, in full, every time, as before.
    if (liteServer === false) {
      const r = await syncOnce(repo, billing(), { mode: 'full', limit: 100, customers: true });
      if (r.bills > 0) liteServer = r.lite ?? false;
      lastFullAt = Date.now();
      return r;
    }
    const full = force || !newest || Date.now() - lastFullAt >= FULL_EVERY_MS;
    if (full) {
      // The latest 30 for cancels and edits; the first read ever takes the latest 100.
      const r = await syncOnce(repo, billing(), { mode: 'full', limit: newest ? 30 : 100, customers: true });
      if (r.bills > 0) liteServer = r.lite ?? false;
      lastFullAt = Date.now();
      return r;
    }
    // Between full reads: only bills newer than the newest stock has.
    const r = await syncOnce(repo, billing(), { mode: 'fast', since: newest.no, limit: 100, customers: false });
    if (r.bills > 0) liteServer = r.lite ?? false;
    // A new bill may be for a new customer: their details come along.
    if (r.newBills) r.customers = await syncCustomers(repo, billing()).catch(() => 0);
    return r;
  })()
    .then(async (r) => {
      last = r;
      for (const g of r.sendGiven) void pushGiven(g.no, g.i, g.given);
      // The first good sync after start (and each after, until done) reads older bills' extra ink.
      if (!backfilled) {
        const n = await backfillMoreInk(repo, billing()).catch(() => -1);
        if (n === 0) backfilled = true;
        else if (n > 0) emit('bills');
      }
      if (r.newBills || r.posted || r.reversed) {
        lastChangeAt = Date.now();
        emit('bills');
      }
      emit('link', { roles: [] });
      const [newest] = await repo.listDocs<{ id: string; no: number }>('bills', { sort: { no: -1 }, limit: 1, fields: ['no'] });
      await recordLink(repo, true, {
        lastBillNo: newest?.no ?? 0,
        message: r.newBills ? r.newBills + ' new bills read' : 'Up to date',
      });
      return r;
    })
    .catch(async (err: Error) => {
      console.error('[billing] sync failed:', err.message);
      await recordLink(repo, false, { message: err.message }).catch(() => undefined);
      return null;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

function mergeResults(a: SyncResult, b: SyncResult): SyncResult {
  return {
    bills: Math.max(a.bills, b.bills),
    newBills: a.newBills + b.newBills,
    posted: a.posted + b.posted,
    reversed: a.reversed + b.reversed,
    toConfirm: Math.max(a.toConfirm, b.toConfirm),
    customers: a.customers + b.customers,
    sendGiven: [...a.sendGiven, ...b.sendGiven],
    lite: a.lite,
    fullFetched: (a.fullFetched ?? 0) + (b.fullFetched ?? 0),
  };
}

export function lastSync(): SyncResult | null {
  return last;
}

export function startLink(): void {
  if (!linkConfigured()) {
    console.log('[billing] BILLING_URL / BILLING_PIN not set: no link to billing');
    return;
  }
  const idle = Math.max(5000, env.billingEveryMs);
  const busy = Math.max(1000, Math.min(idle, env.billingBusyMs));
  console.log('[billing] reading bills from ' + env.billingUrl + ' every ' + Math.round(busy / 1000) + ' s while a bill is open, else ' + Math.round(idle / 1000) + ' s');
  // One timer at a time, set after each read: a slow read never stacks the next on top of it.
  const loop = async () => {
    await syncNow();
    const bills = await getRepo()
      // Only bills inside the busy window can make it busy.
      .listDocs<{ id: string; at: string; cancelled?: boolean }>('bills', {
        filter: { at: { gte: new Date(Date.now() - POLL_ACTIVE_WINDOW_MS).toISOString() } },
        fields: ['at', 'cancelled'],
      })
      .catch(() => []);
    setTimeout(() => void loop(), pollDelay(bills, lastChangeAt, Date.now(), { busy, idle, window: POLL_ACTIVE_WINDOW_MS })).unref();
  };
  void loop();
}
