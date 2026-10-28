import { poStage, type CarrierLoad, type PurchaseOrder } from '@stock/core';
import type { InvRepo } from './store/types';

const now = () => new Date().toISOString();

/**
 * Takes an order's waiting lines off every carrier load (received lines stay as the record).
 * A load left with no lines at all is deleted; the others get a history note. Returns how many
 * load lines went.
 */
export async function dropOrderFromLoads(repo: InvRepo, poIds: string[], by: string, note: string): Promise<number> {
  if (!poIds.length) return 0;
  const want = new Set(poIds);
  const loads = await repo.listDocs<CarrierLoad>('loads', { filter: { 'lines.poId': poIds } });
  let n = 0;
  for (const ld of loads) {
    const gone = ld.lines.filter((x) => want.has(x.poId) && !x.received);
    if (!gone.length) continue;
    n += gone.length;
    ld.lines = ld.lines.filter((x) => !gone.includes(x));
    if (!ld.lines.length) {
      await repo.deleteDoc('loads', ld.id);
      continue;
    }
    ld.history.push({ at: now(), by, action: 'cancel', lines: gone.map((x) => ({ poId: x.poId, itemId: x.itemId, qty: x.qty })), note });
    await repo.putDoc('loads', ld);
  }
  return n;
}

const FLAG = 'loadsCancelCleanup';

/** Once (flagged in meta): load lines still waiting for orders that are cancelled or gone come off. */
export async function cleanStaleLoadLines(repo: InvRepo): Promise<number> {
  if (await repo.getDoc('meta', FLAG)) return 0;
  const [loads, pos] = await Promise.all([repo.listDocs<CarrierLoad>('loads'), repo.listDocs<PurchaseOrder>('pos')]);
  const live = new Map(pos.map((p) => [p.id, p]));
  const stale = new Set<string>();
  for (const ld of loads)
    for (const x of ld.lines) {
      if (x.received) continue;
      const p = live.get(x.poId);
      if (!p || poStage(p.status) !== 'ordered') stale.add(x.poId);
    }
  const n = await dropOrderFromLoads(repo, [...stale], 'system', 'order cancelled or deleted');
  await repo.putDoc('meta', { id: FLAG, at: now(), removed: n });
  return n;
}
