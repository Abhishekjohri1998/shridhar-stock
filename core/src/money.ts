/** Rupees to two places, without the 0.1 + 0.2 drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Quantities to three places: enough for grams of a kilo, no floating dust. */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export function formatRupees(n: number): string {
  const v = round2(n);
  return '₹' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

/** What a shop rounds a bill to: nothing, or the nearest 1, 5 or 10 rupees. */
export const ROUND_STEPS = [0, 1, 5, 10] as const;
export type RoundStep = (typeof ROUND_STEPS)[number];

/**
 * A bill total rounded to the nearest `step` rupees, and the round-off line that gets it there
 * (positive when the customer pays a little more). Step 0 rounds nothing. A half goes up, as at
 * the counter: ₹102.50 to the nearest 5 is ₹105, not ₹100.
 */
export function roundOff(total: number, step: number): { rounded: number; diff: number } {
  const t = round2(total);
  if (!step || step <= 0) return { rounded: t, diff: 0 };
  const rounded = round2(Math.floor(t / step + 0.5 + 1e-9) * step);
  return { rounded, diff: round2(rounded - t) };
}
