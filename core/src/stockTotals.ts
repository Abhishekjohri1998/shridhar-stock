import { round3 } from './money';
import { findUnit, toBase } from './units';
import type { Item, LowAt, StockLevel } from './types';

/**
 * Running low is one number per item, for all places together: the shop and every godown are
 * added up and compared with `lowAt`, which the shop gives in any of the item's units ("5 box").
 *
 * Items saved before this kept a level per place (`reorderAt`). Those are read as their sum, in
 * the base unit, so nothing has to be rewritten in the database for the new rule to apply.
 */
export function lowAtOf(item: Pick<Item, 'units' | 'lowAt' | 'reorderAt'>): LowAt | undefined {
  if (item.lowAt === null) return undefined;
  if (item.lowAt && Number.isFinite(item.lowAt.qty) && findUnit(item, item.lowAt.unit)) return item.lowAt;
  const old = Object.values(item.reorderAt ?? {}).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!old.length) return undefined;
  return { qty: round3(old.reduce((s, n) => s + n, 0)), unit: item.units[0]!.code };
}

/** The running-low level in base units, or undefined when the item has none. */
export function lowBase(item: Pick<Item, 'units' | 'lowAt' | 'reorderAt'>): number | undefined {
  const l = lowAtOf(item);
  return l ? toBase(item, l.unit, l.qty) : undefined;
}

/** An item read from the store, with an old per-place level turned into `lowAt`. */
export function withLowAt<T extends Item>(item: T): T {
  if (item.lowAt !== undefined || !item.reorderAt) return item;
  const l = lowAtOf(item);
  return l ? { ...item, lowAt: l } : item;
}

/** What an item has in all places together, in base units. */
export function totalQty(item: Pick<Item, 'id'>, levels: StockLevel[]): number {
  let sum = 0;
  for (const s of levels) if (s.itemId === item.id) sum += s.qty;
  return round3(sum);
}

/** Totals for every item at once, for lists: one pass over the levels. */
export function totalsByItem(levels: StockLevel[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of levels) m.set(s.itemId, round3((m.get(s.itemId) ?? 0) + s.qty));
  return m;
}

/** Below its level in all places together. An item with no level is never low. */
export function isLow(item: Pick<Item, 'id' | 'units' | 'lowAt' | 'reorderAt'>, total: number): boolean {
  const level = lowBase(item);
  return level != null && total < level;
}
