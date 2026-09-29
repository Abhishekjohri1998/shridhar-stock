import type { Ink } from '@stock/core';

/**
 * A tiny single-stroke "pen" alphabet, for demo handwriting only.
 *
 * The walkthrough needs bills with written lines before the shop's own writing is available.
 * Each glyph is a few polylines on a grid (x-height 5 to 10, ascenders from 0, descenders to 14),
 * slanted and wobbled a little so it reads as written, not typeset. It covers lowercase Latin and
 * digits: real Kannada handwriting comes from the shop's own bills.
 */
const G: Record<string, number[][]> = {
  a: [[5, 6, 3, 5, 1, 6, 0.5, 8, 1.5, 10, 3.5, 10, 5, 8], [5, 5, 5, 10]],
  b: [[0, 0, 0, 10], [0, 7, 2, 5, 4, 6, 4.5, 8, 3, 10, 1, 10, 0, 9]],
  c: [[4.5, 6, 3, 5, 1, 6, 0.5, 8, 1.5, 10, 3.5, 10, 4.5, 9]],
  d: [[5, 6, 3, 5, 1, 6, 0.5, 8, 1.5, 10, 3.5, 10, 5, 8], [5, 0, 5, 10]],
  e: [[0.5, 7.5, 4.5, 7.5, 4, 5.5, 2.5, 5, 1, 6, 0.5, 8, 1.5, 10, 3.5, 10, 4.5, 9]],
  f: [[4, 0.5, 2.5, 0, 1.5, 1, 1.5, 10], [0, 5, 3.5, 5]],
  g: [[5, 6, 3, 5, 1, 6, 0.5, 8, 1.5, 10, 3.5, 10, 5, 8], [5, 5, 5, 12, 4, 13.5, 2, 13.5, 0.5, 12.5]],
  h: [[0, 0, 0, 10], [0, 7, 2, 5, 4, 5.5, 4.5, 7, 4.5, 10]],
  i: [[1, 5, 1, 10], [1, 3, 1.1, 3.2]],
  j: [[2, 5, 2, 12, 1, 13.5, 0, 13], [2, 3, 2.1, 3.2]],
  k: [[0, 0, 0, 10], [4, 5, 0, 8], [1.5, 7, 4.5, 10]],
  l: [[1, 0, 1, 9, 2, 10]],
  m: [[0, 5, 0, 10], [0, 6.5, 1.5, 5, 3, 5.5, 3, 10], [3, 6.5, 4.5, 5, 6, 5.5, 6, 10]],
  n: [[0, 5, 0, 10], [0, 6.5, 2, 5, 4, 5.5, 4.5, 7, 4.5, 10]],
  o: [[2.5, 5, 0.5, 6, 0.5, 9, 2.5, 10, 4.5, 9, 4.5, 6, 2.5, 5]],
  p: [[0, 5, 0, 14], [0, 6.5, 2, 5, 4, 5.5, 4.5, 7.5, 3.5, 10, 1.5, 10, 0, 9]],
  q: [[5, 6, 3, 5, 1, 6, 0.5, 8, 1.5, 10, 3.5, 10, 5, 8], [5, 5, 5, 14]],
  r: [[0, 5, 0, 10], [0, 7, 1.5, 5.3, 3.5, 5]],
  s: [[4, 5.5, 2.5, 5, 1, 5.5, 1, 7, 3.5, 8, 4, 9.3, 2.5, 10, 0.5, 9.5]],
  t: [[1.5, 1.5, 1.5, 9, 2.5, 10, 3.5, 9.5], [0, 5, 3.5, 5]],
  u: [[0, 5, 0, 9, 1.5, 10, 3.5, 9.5, 4.5, 8], [4.5, 5, 4.5, 10]],
  v: [[0, 5, 2.2, 10, 4.5, 5]],
  w: [[0, 5, 1.5, 10, 3, 6.5, 4.5, 10, 6, 5]],
  x: [[0, 5, 4.5, 10], [4.5, 5, 0, 10]],
  y: [[0, 5, 2.2, 10], [4.5, 5, 1, 14]],
  z: [[0, 5, 4.5, 5, 0, 10, 4.5, 10]],
  '0': [[2.5, 0, 0.5, 2, 0.5, 8, 2.5, 10, 4.5, 8, 4.5, 2, 2.5, 0]],
  '1': [[1, 2, 2.5, 0, 2.5, 10]],
  '2': [[0.5, 2, 2, 0, 4, 0.5, 4.5, 2.5, 0, 10, 4.5, 10]],
  '3': [[0.5, 1, 2.5, 0, 4.5, 1.5, 3.5, 4.5, 2, 5, 4.5, 6.5, 4.5, 8.5, 2.5, 10, 0.5, 9]],
  '4': [[3.5, 10, 3.5, 0, 0, 7, 5, 7]],
  '5': [[4.5, 0, 1, 0, 0.5, 4.5, 2.5, 4, 4.5, 5.5, 4.5, 8.5, 2.5, 10, 0.5, 9]],
  '-': [[0.5, 7, 3.5, 7]],
};

function widthOf(g: number[][]): number {
  let w = 0;
  for (const s of g) for (let i = 0; i < s.length; i += 2) w = Math.max(w, s[i]!);
  return w;
}

/** A seeded wobble, so the same text always gives the same demo writing. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function handwrite(text: string, seed = 1): Ink {
  const rand = rng(seed);
  const unit = 5;
  const strokes: number[][] = [];
  let x = 6;
  for (const ch of text.toLowerCase()) {
    if (ch === ' ') {
      x += 3.2 * unit;
      continue;
    }
    const g = G[ch];
    if (!g) continue;
    const dy = (rand() - 0.5) * 1.2;
    for (const s of g) {
      const out: number[] = [];
      for (let i = 0; i + 1 < s.length; i += 2) {
        const gx = s[i]! + (rand() - 0.5) * 0.35;
        const gy = s[i + 1]! + (rand() - 0.5) * 0.35 + dy;
        // Slant forward, as a hand does.
        out.push(Math.round((x + (gx + (10 - gy) * 0.22) * unit) * 10) / 10, Math.round((8 + gy * unit) * 10) / 10);
      }
      strokes.push(out);
    }
    x += (widthOf(g) + 1.4) * unit;
  }
  return { w: Math.ceil(x + 10), h: 90, strokes };
}
