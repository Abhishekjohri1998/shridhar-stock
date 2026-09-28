import type { StockLevel, StockMove } from '@stock/core';
import type { InvRepo } from './store/types';

/**
 * The only way stock changes.
 *
 * Each move goes into the ledger under its unique key first. A key already there means the move
 * was posted before -- a retry, a double tap, a restarted sync -- and nothing happens. Only a move
 * that is new moves the cached numbers.
 *
 * There are no transactions here (the free Atlas tier, and the file store), so the ledger is
 * written before the cache: if the server stops between the two, the ledger is right and the
 * cache is behind, which `reconcile` puts right. The other order would lose the record of why.
 */
export async function post(repo: InvRepo, moves: StockMove[]): Promise<StockMove[]> {
  const posted: StockMove[] = [];
  for (const m of moves) {
    if (!(m.qty > 0)) continue;
    if (!(await repo.insertMove(m))) continue;
    posted.push(m);
    try {
      if (m.from) await repo.incStock(m.itemId, m.from, -m.qty);
      if (m.to) await repo.incStock(m.itemId, m.to, m.qty);
    } catch (err) {
      // The move is in the ledger; the next reconcile brings the cache into line with it.
      console.error('[stock] cache update failed for ' + m.key + ', reconcile will fix it', err);
    }
  }
  return posted;
}

export interface Difference {
  itemId: string;
  locationId: string;
  cached: number;
  ledger: number;
}

/**
 * Rebuilds the cached numbers from the ledger and reports what was wrong.
 *
 * Every (item, place) that either side knows about is compared, so a cache row with no moves
 * behind it is found as readily as a missing one.
 */
export async function reconcile(repo: InvRepo, itemIds?: string[]): Promise<{ checked: number; fixed: Difference[] }> {
  const [cache, ledger] = await Promise.all([repo.listStock(itemIds), repo.ledgerLevels(itemIds)]);
  const key = (s: StockLevel) => s.itemId + '|' + s.locationId;
  const want = new Map(ledger.map((s) => [key(s), s.qty]));
  const have = new Map(cache.map((s) => [key(s), s.qty]));
  const fixed: Difference[] = [];
  const all = new Set([...want.keys(), ...have.keys()]);
  for (const k of all) {
    const ledgerQty = want.get(k) ?? 0;
    const cached = have.get(k) ?? 0;
    if (Math.abs(ledgerQty - cached) > 1e-6) {
      const [itemId, locationId] = k.split('|') as [string, string];
      await repo.setStock(itemId, locationId, ledgerQty);
      fixed.push({ itemId, locationId, cached, ledger: ledgerQty });
    }
  }
  return { checked: all.size, fixed };
}
