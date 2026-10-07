import { rackNames } from './pick';
import { isLow, isLowAt, placeLowBase, lowBase, totalsByItem } from './stockTotals';
import type { Item, Location, PlaceLayout, RackBox, StockLevel } from './types';

/** Rack size and spacing for the sample layout. */
const W = 2.4;
const D = 0.6;
const H = 2;
const GAP_X = 0.8;
const AISLE = 1.8;
const PER_ROW = 4;
const NO_RACK = 'No rack';

/**
 * The sample floor plan for a place, from its rack names alone: rows of up to four shelving units,
 * an aisle between rows, centred on the origin. The same names always give the same plan.
 */
export function defaultLayout(names: string[]): PlaceLayout {
  const rows = Math.ceil(names.length / PER_ROW);
  const racks = names.map((name, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const inRow = Math.min(PER_ROW, names.length - row * PER_ROW);
    const rowW = inRow * W + (inRow - 1) * GAP_X;
    const x = -rowW / 2 + W / 2 + col * (W + GAP_X);
    const z = (row - (rows - 1) / 2) * (D + AISLE);
    return { name, x: round2(x), z: round2(z), w: W, d: D, h: H, rot: 0 };
  });
  return { racks };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

/** A saved layout, checked: anything malformed is dropped, never thrown. */
export function cleanLayout(raw: unknown): PlaceLayout | undefined {
  const racks = (raw as PlaceLayout | undefined)?.racks;
  if (!Array.isArray(racks)) return undefined;
  const out = racks.filter(
    (r): r is RackBox =>
      !!r && typeof r.name === 'string' && r.name.trim() !== '' && fin(r.x, -500, 500) && fin(r.z, -500, 500) && fin(r.w, 0.1, 50) && fin(r.d, 0.1, 50) && fin(r.h, 0.1, 20) && fin(r.rot, -360, 360),
  );
  return { racks: out.map((r) => ({ name: r.name.trim(), x: r.x, z: r.z, w: r.w, d: r.d, h: r.h, rot: r.rot })) };
}

/**
 * The plan to draw for a place: its saved layout, plus a sample row for any rack not on it (and a
 * "No rack" unit when some items there have none). Without a saved layout it is the sample plan.
 */
export function layoutFor(loc: Pick<Location, 'id' | 'layout'>, items: Pick<Item, 'racks'>[], stockedIds?: Set<string>): PlaceLayout {
  const names = rackNames(items, loc.id);
  const loose = stockedIds && items.some((it) => !String(it.racks?.[loc.id] ?? '').trim() && stockedIds.has((it as { id?: string }).id ?? ''));
  if (loose) names.push(NO_RACK);
  const saved = cleanLayout(loc.layout);
  if (!saved || !saved.racks.length) return defaultLayout(names);
  const have = new Set(saved.racks.map((r) => r.name.toLowerCase()));
  const missing = names.filter((n) => !have.has(n.toLowerCase()));
  if (!missing.length) return saved;
  const back = Math.max(...saved.racks.map((r) => r.z + r.d / 2)) + AISLE;
  const extra = defaultLayout(missing).racks;
  const minZ = Math.min(...extra.map((r) => r.z - r.d / 2));
  return { racks: [...saved.racks, ...extra.map((r) => ({ ...r, z: round2(r.z - minZ + back) }))] };
}

export type RackStatus = 'ok' | 'getting-low' | 'low' | 'empty';

export interface RackLine {
  item: Item;
  /** Stock of this item at this place, in base units. */
  qty: number;
  status: RackStatus;
}

/**
 * How one item stands at one place. Its running-out level at that place decides, else its level for
 * all places together read against the total. Low is below the level; getting low is under 1.5×.
 */
export function itemStatusAt(item: Item, locId: string, qty: number, total: number): RackStatus {
  const place = placeLowBase(item, locId);
  if (qty <= 0) {
    if (place != null) return 'low';
    if (lowBase(item) == null) return 'empty';
    return isLow(item, total) ? 'low' : 'getting-low';
  }
  if (place != null) {
    if (isLowAt(item, locId, qty)) return 'low';
    return qty < place * 1.5 ? 'getting-low' : 'ok';
  }
  const level = lowBase(item);
  if (level == null) return 'ok';
  if (isLow(item, total)) return 'low';
  return total < level * 1.5 ? 'getting-low' : 'ok';
}

const RANK: Record<RackStatus, number> = { empty: 0, ok: 1, 'getting-low': 2, low: 3 };

/** A rack's colour: its worst item; grey only when nothing on it has stock or a level. */
export function rackStatus(lines: Pick<RackLine, 'status'>[]): RackStatus {
  let worst: RackStatus = 'empty';
  for (const l of lines) if (RANK[l.status] > RANK[worst]) worst = l.status;
  return worst;
}

/** Each rack's items at a place, with their stock there and status. Keyed by rack name, lower case. */
export function rackContents(items: Item[], stock: StockLevel[], locId: string): Map<string, RackLine[]> {
  const totals = totalsByItem(stock);
  const here = new Map<string, number>();
  for (const s of stock) if (s.locationId === locId) here.set(s.itemId, s.qty);
  const out = new Map<string, RackLine[]>();
  for (const item of items) {
    if (!item.active) continue;
    const rack = String(item.racks?.[locId] ?? '').trim();
    const qty = here.get(item.id) ?? 0;
    if (!rack && !here.has(item.id)) continue;
    const key = (rack || NO_RACK).toLowerCase();
    const list = out.get(key) ?? [];
    list.push({ item, qty, status: itemStatusAt(item, locId, qty, totals.get(item.id) ?? 0) });
    out.set(key, list);
  }
  return out;
}
