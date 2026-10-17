import { consumeFefo, describeQty, lowAtOf, lowBase, totalQty, type Lot, type StockLevel, type StockMove } from '@stock/core';
import { newId } from './store/types';
import { emit } from './events';
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
  if (posted.length) {
    const places = [...new Set(posted.flatMap((m) => [m.from, m.to]).filter((x): x is string => !!x))];
    emit('stock', { locationIds: places });
    try {
      await moveLots(repo, posted);
    } catch (err) {
      // Lots only say what expires when: a failure here never holds up a sale.
      console.error('[stock] could not update expiry lots', err);
    }
    try {
      await noteLow(repo, posted);
    } catch (err) {
      console.error('[stock] could not check for running low', err);
    }
  }
  return posted;
}

/**
 * Expiry lots follow the stock (purchasing, B): anything leaving a place comes out of its lots
 * earliest expiry first. A transfer carries its lots "in transit" under the transfer's ref and
 * puts them down where it is received, as much as arrived; a short arrival drops the rest.
 * Stock with no lot is simply not tracked, so nothing is ever refused here.
 */
async function moveLots(repo: InvRepo, posted: StockMove[]): Promise<void> {
  for (const m of posted) {
    if (m.from) {
      const lots = await repo.listDocs<Lot>('lots', { itemId: m.itemId, placeId: m.from });
      if (!lots.length) continue;
      const { after, taken } = consumeFefo(lots, m.qty);
      await saveLots(repo, after, lots);
      if (m.kind === 'transfer_out' && taken.length)
        await repo.putDocs<Lot>('lots', taken.map((t) => ({ ...t.lot, id: newId('lot'), placeId: 'transit:' + m.ref, qty: t.qty })));
    }
    if (m.to && m.kind === 'transfer_in') {
      const transit = await repo.listDocs<Lot>('lots', { itemId: m.itemId, placeId: 'transit:' + m.ref });
      if (!transit.length) continue;
      const { taken } = consumeFefo(transit, m.qty);
      for (const l of transit) await repo.deleteDoc('lots', l.id);
      if (taken.length) await repo.putDocs<Lot>('lots', taken.map((t) => ({ ...t.lot, id: newId('lot'), placeId: m.to!, qty: t.qty })));
    }
  }
}

/** Writes the lots that changed; a lot used up is removed. */
async function saveLots(repo: InvRepo, after: Lot[], before: Lot[]): Promise<void> {
  const was = new Map(before.map((l) => [l.id, l.qty]));
  for (const l of after) {
    if (l.qty <= 1e-9) await repo.deleteDoc('lots', l.id);
    else if (was.get(l.id) !== l.qty) await repo.putDoc('lots', l);
  }
}

/** One item that went below its level, for the Home "Needs you now" card. */
export interface LowAlert {
  itemId: string;
  at: string;
  /** All places together, just after the move, in base units, and in the shop's words. */
  total: number;
  words: string;
  level: string;
}

const ALERTS_KEPT = 50;

/**
 * When a sale or a move takes an item's total, in all places together, from at or above its
 * running-out level to below it, that is written down once and the admin's screens are told.
 * Moves that only shift stock between places leave the total alone, so they never alert.
 */
async function noteLow(repo: InvRepo, posted: StockMove[]): Promise<void> {
  const change = new Map<string, number>();
  for (const m of posted) change.set(m.itemId, (change.get(m.itemId) ?? 0) + (m.to ? m.qty : 0) - (m.from ? m.qty : 0));
  const down = [...change.entries()].filter(([, d]) => d < 0).map(([id]) => id);
  if (!down.length) return;
  const levels = await repo.listStock(down);
  const fresh: LowAlert[] = [];
  for (const id of down) {
    const item = await repo.getItem(id);
    const level = item ? lowBase(item) : undefined;
    if (!item || level == null) continue;
    const now = totalQty(item, levels);
    const before = now - change.get(id)!;
    if (before >= level && now < level) {
      const l = lowAtOf(item)!;
      fresh.push({ itemId: id, at: new Date().toISOString(), total: now, words: describeQty(item, now), level: l.qty + ' ' + l.unit });
    }
  }
  if (!fresh.length) return;
  const doc = await repo.getDoc<{ id: string; list: LowAlert[] }>('meta', 'lowAlerts');
  const kept = (doc?.list ?? []).filter((a) => !fresh.some((f) => f.itemId === a.itemId));
  await repo.putDoc('meta', { id: 'lowAlerts', list: [...fresh, ...kept].slice(0, ALERTS_KEPT) });
  for (const a of fresh) emit('low', {}, a.itemId);
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
