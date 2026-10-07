import { round3 } from './money';
import type { Item, ItemUnit } from './types';

export function baseUnit(item: Pick<Item, 'units'>): ItemUnit {
  const u = item.units[0];
  if (!u) throw new Error('An item needs at least its base unit');
  return u;
}

/** Unit codes are matched without regard to case or spaces: "Box" and "box " are the same unit. */
export function unitKey(code: string): string {
  return String(code ?? '').trim().toLowerCase();
}

export function findUnit(item: Pick<Item, 'units'>, code: string): ItemUnit | undefined {
  const k = unitKey(code);
  return item.units.find((u) => unitKey(u.code) === k);
}

/** 2 packs of Parle-G is 48 pieces. */
export function toBase(item: Pick<Item, 'units'>, code: string, qty: number): number {
  const unit = findUnit(item, code);
  if (!unit) throw new Error('No unit "' + code + '" on this item');
  return round3(qty * unit.perBase);
}

/** 48 pieces of Parle-G is 2 packs. */
export function fromBase(item: Pick<Item, 'units'>, code: string, baseQty: number): number {
  const unit = findUnit(item, code);
  if (!unit) throw new Error('No unit "' + code + '" on this item');
  return round3(baseQty / unit.perBase);
}

/**
 * A base quantity the way the shop would say it: 150 pieces is "1 box 6 pc", not "150 pc".
 *
 * Largest unit first, each taking as many whole ones as fit, and whatever is left in the base unit.
 */
export function describeQty(item: Pick<Item, 'units'>, baseQty: number, lang: 'en' | 'kn' = 'en'): string {
  const base = baseUnit(item);
  // The short code in English reads the way the shop says it ("2 pack 6 pc"); Kannada has its own word.
  const label = (u: ItemUnit) => (lang === 'kn' && u.labelKn ? u.labelKn : u.code);
  const sign = baseQty < 0 ? '-' : '';
  let left = Math.abs(round3(baseQty));
  if (left === 0) return '0 ' + label(base);
  const parts: string[] = [];
  const bigger = item.units.slice(1).filter((u) => u.perBase > 1).sort((a, b) => b.perBase - a.perBase);
  for (const u of bigger) {
    const n = Math.floor(left / u.perBase + 1e-9);
    if (n > 0) {
      parts.push(n + ' ' + label(u));
      left = round3(left - n * u.perBase);
    }
  }
  if (left > 0 || parts.length === 0) parts.push(left + ' ' + label(base));
  return sign + parts.join(' ');
}

/**
 * The unit the shop counts this item in by default: the one it chose, or for older items (and a
 * choice whose unit was since removed) the first unit. Read here, never written back, so items
 * saved before there was a default need no change in the database.
 */
export function defaultUnitOf(item: Pick<Item, 'units'> & { defaultUnit?: string }): ItemUnit {
  return (item.defaultUnit ? findUnit(item, item.defaultUnit) : undefined) ?? baseUnit(item);
}

/** The item's units with the default one first and the rest in their own order. */
export function unitsDefaultFirst(item: Pick<Item, 'units'> & { defaultUnit?: string }): ItemUnit[] {
  const d = defaultUnitOf(item);
  return [d, ...item.units.filter((u) => u !== d)];
}

/**
 * The unit billing offers first: the one chosen to sell in, else the default unit, else the first.
 * Read here, never written back.
 */
export function sellUnitOf(item: Pick<Item, 'units'> & { defaultUnit?: string; sellUnit?: string }): ItemUnit {
  return (item.sellUnit ? findUnit(item, item.sellUnit) : undefined) ?? defaultUnitOf(item);
}

/** The item's units with the selling one first and the rest in their own order. */
export function unitsSellFirst(item: Pick<Item, 'units'> & { defaultUnit?: string; sellUnit?: string }): ItemUnit[] {
  const s = sellUnitOf(item);
  return [s, ...item.units.filter((u) => u !== s)];
}

/** A base quantity in one unit, as a plain number and the unit: 150 pc is "1.042 box". */
export function qtyInUnit(item: Pick<Item, 'units'>, code: string, baseQty: number, lang: 'en' | 'kn' = 'en'): string {
  const u = findUnit(item, code) ?? baseUnit(item);
  return round3(baseQty / u.perBase) + ' ' + (lang === 'kn' && u.labelKn ? u.labelKn : u.code);
}
