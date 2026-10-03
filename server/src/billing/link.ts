import { env } from '../env';
import { getRepo } from '../store';
import { billingClient } from './client';
import { emit } from '../events';
import { pickReader, readPending } from '../reader';
import { pollDelay, recordLink, syncOnce, POLL_ACTIVE_WINDOW_MS, type SyncResult } from './sync';

const reader = pickReader();
console.log('[reader] handwriting reader: ' + reader.kind);

let running: Promise<SyncResult | null> | null = null;
let last: SyncResult | null = null;
/** When a read last brought something new: keeps the quick polling going while the counter is busy. */
let lastChangeAt = 0;

export const linkConfigured = () => !!(env.billingUrl && env.billingPin);

/** One sync, never two at once: a slow billing server must not pile runs up. */
export function syncNow(): Promise<SyncResult | null> {
  if (!linkConfigured()) return Promise.resolve(null);
  if (running) return running;
  const repo = getRepo();
  running = syncOnce(repo, billingClient(env.billingUrl, env.billingPin))
    .then(async (r) => {
      last = r;
      // New handwritten lines are read straight after they arrive.
      const read = await readPending(repo, reader.fn).catch((err: Error) => {
        console.error('[reader] failed:', err.message);
        return null;
      });
      if (read) Object.assign(r, { read: read.read, autoRead: read.auto });
      if (r.newBills || r.posted || r.reversed || read?.read) {
        lastChangeAt = Date.now();
        emit('bills');
      }
      emit('link', { roles: [] });
      const bills = await repo.listDocs<{ id: string; no: number }>('bills');
      await recordLink(repo, true, {
        lastBillNo: bills.reduce((m, b) => Math.max(m, b.no), 0),
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
      .listDocs<{ id: string; at: string; cancelled?: boolean }>('bills')
      .catch(() => []);
    setTimeout(() => void loop(), pollDelay(bills, lastChangeAt, Date.now(), { busy, idle, window: POLL_ACTIVE_WINDOW_MS })).unref();
  };
  void loop();
}
