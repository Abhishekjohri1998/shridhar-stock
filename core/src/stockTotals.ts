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

type PlaceLowItem = Pick<Item, 'units' | 'lowAt' | 'reorderAt' | 'lowAtPlace'>;

/**
 * Running out at each place, keyed by place id. Entries in a unit the item no longer has are
 * left out. An item never saved under the per-place rule (no `lowAtPlace`, no `lowAt`) reads its
 * old `reorderAt` levels here, in the base unit; nothing is written back.
 */
export function lowAtPlaceOf(item: PlaceLowItem): Record<string, LowAt> {
  const out: Record<string, LowAt> = {};
  if (item.lowAtPlace) {
    for (const [loc, l] of Object.entries(item.lowAtPlace)) {
      const u = l && Number.isFinite(l.qty) && l.qty >= 0 ? findUnit(item, l.unit) : undefined;
      if (u) out[loc] = { qty: l.qty, unit: u.code };
    }
    return out;
  }
  if (item.lowAt !== undefined) return out;
  for (const [loc, n] of Object.entries(item.reorderAt ?? {})) {
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[loc] = { qty: round3(n), unit: item.units[0]!.code };
  }
  return out;
}

/** The running-out level at one place in base units, or undefined when that place has none. */
export function placeLowBase(item: PlaceLowItem, locId: string): number | undefined {
  const l = lowAtPlaceOf(item)[locId];
  return l ? toBase(item, l.unit, l.qty) : undefined;
}

/** Below its level at this place. A place with no level is never low. */
export function isLowAt(item: PlaceLowItem, locId: string, qty: number): boolean {
  const level = placeLowBase(item, locId);
  return level != null && qty < level;
}

/**
 * The unit an item is bought in: its default unit when the shop chose one, else the biggest one,
 * which is how suppliers sell.
 */
export function buyUnitOf(item: Pick<Item, 'units'> & { defaultUnit?: string }): Item['units'][number] {
  const chosen = item.defaultUnit ? findUnit(item, item.defaultUnit) : undefined;
  return chosen ?? [...item.units].sort((a, b) => b.perBase - a.perBase)[0]!;
}

/**
 * How much to buy of an item that is running low: enough to bring the total in all places back
 * to twice its level, rounded up to whole buying units, and at least one. Undefined when the
 * item has no level or is not below it.
 */
export function suggestBuyQty(
  item: Pick<Item, 'units' | 'lowAt' | 'reorderAt'> & { defaultUnit?: string },
  total: number,
): { qty: number; unit: string } | undefined {
  const level = lowBase(item);
  if (level == null || !(total < level)) return undefined;
  const u = buyUnitOf(item);
  return { qty: Math.max(1, Math.ceil(round3((2 * level - total) / u.perBase))), unit: u.code };
}

/** What a place holds now, and what it held before but has none of now (with the last move's date). */
export function placeItems(
  placeId: string,
  levels: StockLevel[],
  moves: { itemId: string; at: string; from?: string; to?: string }[],
): { now: { itemId: string; qty: number }[]; before: { itemId: string; lastAt: string }[] } {
  const now: { itemId: string; qty: number }[] = [];
  const has = new Set<string>();
  for (const s of levels) {
    if (s.locationId !== placeId || !(round3(s.qty) > 0)) continue;
    now.push({ itemId: s.itemId, qty: round3(s.qty) });
    has.add(s.itemId);
  }
  now.sort((a, b) => b.qty - a.qty);
  const last = new Map<string, string>();
  for (const m of moves) {
    if (m.from !== placeId && m.to !== placeId) continue;
    if (has.has(m.itemId)) continue;
    const cur = last.get(m.itemId);
    if (!cur || m.at > cur) last.set(m.itemId, m.at);
  }
  const before = [...last].map(([itemId, lastAt]) => ({ itemId, lastAt })).sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return { now, before };
}
