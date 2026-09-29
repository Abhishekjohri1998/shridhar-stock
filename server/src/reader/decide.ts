import { findUnit, priceFor, type Item, type MirrorLine, type Reading } from '@stock/core';

/** How sure the reader must be before stock moves without a person. Tuned by the reader eval. */
export const AUTO_CONFIDENCE = 0.85;
/** How far the billed rate may be from the item's own price for that unit and quantity. */
export const PRICE_TOLERANCE = 0.15;

export type Decision =
  | { auto: true; itemId: string; unit: string; baseQty: number }
  | { auto: false; reason: 'no-item' | 'unsure' | 'inactive' | 'unit' | 'price' | 'qty' };

/**
 * Whether a reading is good enough to move stock by itself.
 *
 * Every rule must hold. Being sure of the words is not enough: a line read as "biryani masala"
 * with ₹1000 beside it is not a ₹90 pack, and moving the wrong stock silently is worse than
 * asking. So the price the shopkeeper typed has to agree with what was read.
 */
export function decide(reading: Reading, line: Pick<MirrorLine, 'qty' | 'rate'>, item: Item | undefined): Decision {
  if (!reading.itemId || !item) return { auto: false, reason: 'no-item' };
  if (!item.active) return { auto: false, reason: 'inactive' };
  if (reading.confidence < AUTO_CONFIDENCE) return { auto: false, reason: 'unsure' };
  const unit = reading.unit && findUnit(item, reading.unit) ? reading.unit : item.units[0]!.code;
  if (reading.unit && !findUnit(item, reading.unit)) return { auto: false, reason: 'unit' };
  if (reading.qty != null && Math.abs(reading.qty - line.qty) > 1e-9) return { auto: false, reason: 'qty' };
  const p = priceFor(item, unit, line.qty);
  if (p.rate > 0 && Math.abs(line.rate - p.rate) > p.rate * PRICE_TOLERANCE) return { auto: false, reason: 'price' };
  return { auto: true, itemId: item.id, unit, baseQty: p.baseQty };
}
