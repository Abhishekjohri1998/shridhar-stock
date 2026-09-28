import { round2 } from './money';
import { findUnit } from './units';
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
    rate,
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
