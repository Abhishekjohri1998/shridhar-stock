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
