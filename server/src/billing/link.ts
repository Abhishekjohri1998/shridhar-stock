import { env } from '../env';
import { getRepo } from '../store';
import { billingClient, type BillingClient } from './client';
import { emit } from '../events';
import { pushGiven } from './push';
import { pollDelay, recordLink, syncOnce, POLL_ACTIVE_WINDOW_MS, type SyncResult } from './sync';

let running: Promise<SyncResult | null> | null = null;
let last: SyncResult | null = null;
/** When a read last brought something new: keeps the quick polling going while the counter is busy. */
let lastChangeAt = 0;

export const linkConfigured = () => !!(env.billingUrl && env.billingPin);

let shared: BillingClient | null = null;
/** One signed-in client for reads and pushes alike, so its token is reused, not fetched per read. */
export function billing(): BillingClient {
  shared ??= billingClient(env.billingUrl, env.billingPin);
  return shared;
}

/** One sync, never two at once: a slow billing server must not pile runs up. */
export function syncNow(): Promise<SyncResult | null> {
  if (!linkConfigured()) return Promise.resolve(null);
  if (running) return running;
  const repo = getRepo();
  running = syncOnce(repo, billing())
    .then(async (r) => {
      last = r;
      for (const g of r.sendGiven) void pushGiven(g.no, g.i, g.given);
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
