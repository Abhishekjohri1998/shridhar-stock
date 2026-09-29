import type { Ink } from './types';

/**
 * An SVG path for pen strokes, for showing handwriting on any screen.
 *
 * Strokes are in the billing app's format, [x0, y0, x1, y1, ...], so a line written on the
 * billing tablet shows here exactly as it was written.
 */
export function inkPath(ink: Ink): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  const parts: string[] = [];
  for (const s of ink.strokes) {
    if (s.length < 2) continue;
    parts.push('M' + r(s[0]!) + ' ' + r(s[1]!));
    if (s.length < 4) {
      parts.push('l0.01 0');
      continue;
    }
    for (let i = 2; i + 1 < s.length; i += 2) parts.push('L' + r(s[i]!) + ' ' + r(s[i + 1]!));
  }
  return parts.join('');
}

/** The box the writing actually covers, so it can be shown without the empty strip around it. */
export function inkBounds(ink: Ink): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of ink.strokes) {
    for (let i = 0; i + 1 < s.length; i += 2) {
      minX = Math.min(minX, s[i]!);
      maxX = Math.max(maxX, s[i]!);
      minY = Math.min(minY, s[i + 1]!);
      maxY = Math.max(maxY, s[i + 1]!);
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: ink.w, maxY: ink.h };
  return { minX, minY, maxX, maxY };
}

export function hasInk(ink: Ink | undefined | null): ink is Ink {
  return !!ink && ink.strokes.some((s) => s.length >= 2);
}
