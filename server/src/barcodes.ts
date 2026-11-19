import { itemBarcodes, withUnknownScan, type Item, type UnknownScan } from '@stock/core';
import { getRepo } from './store';

/**
 * The barcodes the counter scanned that no item has yet, kept in meta for the admin
 * (Inventory → "Scanned, not linked"). Each is counted, so the codes scanned most come to light.
 */
const DOC = 'unknownScans';

type ScanDoc = { id: string; list: UnknownScan[] };

/** One write at a time, so two scans arriving together both count. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export async function listUnknownScans(): Promise<UnknownScan[]> {
  const doc = await getRepo().getDoc<ScanDoc>('meta', DOC);
  return Array.isArray(doc?.list) ? doc!.list : [];
}

export function noteUnknownScan(code: string, at = new Date().toISOString()): Promise<void> {
  return serial(async () => {
    const list = withUnknownScan(await listUnknownScans(), code, at);
    await getRepo().putDoc('meta', { id: DOC, list });
  });
}

/** Takes codes off the list: linked to an item now, or dismissed. Quiet when none were there. */
export function dropUnknownScans(codes: string[]): Promise<void> {
  if (!codes.length) return Promise.resolve();
  return serial(async () => {
    const list = await listUnknownScans();
    const kept = list.filter((s) => !codes.includes(s.code));
    if (kept.length !== list.length) await getRepo().putDoc('meta', { id: DOC, list: kept });
  });
}

/**
 * A code on `item` that another active item already has, with that item's name, or null. One code
 * means one thing at the counter, so a second owner is refused rather than guessed between.
 */
export function barcodeClash(items: Item[], item: Pick<Item, 'id' | 'units'>): { code: string; other: Item } | null {
  const mine = itemBarcodes(item);
  if (!mine.length) return null;
  for (const other of items) {
    if (other.id === item.id || !other.active) continue;
    const theirs = new Set(itemBarcodes(other).map((b) => b.code));
    const hit = mine.find((b) => theirs.has(b.code));
    if (hit) return { code: hit.code, other };
  }
  return null;
}
