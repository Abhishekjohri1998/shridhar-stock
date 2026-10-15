import { round2, round4 } from './money';
import { findUnit, sellUnitOf } from './units';
import type { Item, ItemUnit, Slab } from './types';

export interface Price {
  unit: string;
  /** Rate for one of the unit. */
  rate: number;
  amount: number;
  /** The quantity in base units, which is what stock moves by. */
  baseQty: number;
  /** The slab that set the rate, if one did. */
  slab?: Slab;
}

/** The slab with the highest threshold the quantity has reached, if any. */
export function slabFor(unit: ItemUnit, qty: number): Slab | undefined {
  let best: Slab | undefined;
  for (const s of unit.slabs ?? []) {
    if (qty >= s.minQty && (!best || s.minQty > best.minQty)) best = s;
  }
  return best;
}

/**
 * What `qty` of an item in a unit costs.
 *
 * A pack of 24 Parle-G is ₹110, not 24 × ₹5: the pack is its own unit with its own price, so this
 * never multiplies up from pieces. Slabs lower the rate from a quantity upwards (5 lines of Clinic
 * Plus or more at ₹28 a line).
 */
export function priceFor(item: Pick<Item, 'units'>, unitCode: string, qty: number): Price {
  const unit = findUnit(item, unitCode);
  if (!unit) throw new Error('No unit "' + unitCode + '" on this item');
  const slab = slabFor(unit, qty);
  const rate = slab ? slab.rate : unit.price;
  return {
    unit: unit.code,
    rate: round4(rate),
    amount: round2(rate * qty),
    baseQty: Math.round(qty * unit.perBase * 1000) / 1000,
    ...(slab ? { slab } : {}),
  };
}

/**
 * Whether a rate someone billed is outside what the shop allows for that unit.
 *
 * Bargaining is normal, so this never refuses anything. It is how a bill that went too low is
 * found afterwards.
 */
export function rateRange(unit: ItemUnit, rate: number): 'low' | 'high' | null {
  if (unit.min != null && rate < unit.min) return 'low';
  if (unit.max != null && rate > unit.max) return 'high';
  return null;
}

/** What one of a unit costs: its own price, or the slab that already starts at 1 or below. */
export function unitRate1(unit: ItemUnit): number {
  return round4(slabFor(unit, 1)?.rate ?? unit.price);
}

/** The price of one of the item's selling unit, and that unit's slabs, for lists that show a price. */
export function sellPriceOf(item: Pick<Item, 'units'> & { defaultUnit?: string; sellUnit?: string }): { unit: ItemUnit; rate: number; slabs: Slab[] } {
  const unit = sellUnitOf(item);
  return { unit, rate: unitRate1(unit), slabs: unit.slabs ?? [] };
}

/** One row of the "price by pack size" helper: a pack's size in the base unit, its price, and the quantity its rate starts from. */
export interface PackPrice {
  size: number;
  price: number;
  /** The base-unit quantity this pack's rate starts from. Defaults to the pack size. */
  from?: number;
}

/** What the pack-size helper writes to the base unit, and what each pack then costs. */
export interface PackSlabs {
  /** The base unit's own price: the smallest pack's rate. */
  price: number;
  /** One slab per other pack, {minQty: from, rate}, sorted by minQty. */
  slabs: Slab[];
  /** Each pack's per-base-unit rate and what it costs with the price and slabs above, smallest first. */
  quotes: { size: number; rate: number; amount: number }[];
}

/** One pack's per-base-unit rate, exact to 4 places (₹28 for 500 g is 0.056). */
export const packRate = (p: { size: number; price: number }): number => round4(p.price / p.size);

/**
 * The base unit's price and slabs from pack sizes and their prices. The smallest pack's rate is the
 * base price; every other pack becomes a slab from its `from` (or its size). Rows without a size
 * above 0 or a price of 0 or more are skipped. Returns null when no row is usable.
 */
export function slabsFromPacks(packs: PackPrice[]): PackSlabs | null {
  const ok = packs
    .filter((p) => Number.isFinite(p.size) && p.size > 0 && Number.isFinite(p.price) && p.price >= 0)
    .sort((a, b) => a.size - b.size);
  if (!ok.length) return null;
  const price = packRate(ok[0]!);
  const byMin = new Map<number, number>();
  for (const p of ok.slice(1)) {
    const from = p.from != null && Number.isFinite(p.from) && p.from > 0 ? p.from : p.size;
    const rate = packRate(p);
    const had = byMin.get(from);
    // Two packs from the same quantity: the cheaper rate wins.
    byMin.set(from, had == null ? rate : Math.min(had, rate));
  }
  const slabs = [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([minQty, rate]) => ({ minQty, rate }));
  const unit = { code: 'base', label: '', labelKn: '', perBase: 1, price, slabs } as ItemUnit;
  const quotes = ok.map((p) => ({ size: p.size, rate: packRate(p), amount: priceFor({ units: [unit] }, 'base', p.size).amount }));
  return { price, slabs, quotes };
}
