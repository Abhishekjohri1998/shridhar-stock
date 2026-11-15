import { defaultUnitOf } from './units';
import type { BillMirror, Item } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One item's share of the stock value at cost. */
export interface StockValueRow {
  itemId: string;
  nameEn: string;
  nameKn: string;
  active: boolean;
  /** Held, in base units (only places with more than zero count, as on Home). */
  baseQty: number;
  baseUnit: string;
  /** The same in the item's default unit. */
  unit: string;
  qty: number;
  /** Cost of one default unit, or null when the item has no cost. */
  unitCost: number | null;
  value: number;
  noCost: boolean;
}

/**
 * Stock value at cost, item by item. Worked out exactly as Home's tile (stockValueOf): every item,
 * stock above zero at each place, base cost times base quantity, so the rows add up to the tile.
 * `locationId` keeps one place only.
 */
export function stockValueRows(items: Pick<Item, 'id' | 'units' | 'nameEn' | 'nameKn' | 'active' | 'defaultUnit'>[], stock: { itemId: string; locationId?: string; qty: number }[], locationId?: string) {
  const held = new Map<string, number>();
  for (const s of stock) if (s.qty > 0 && (!locationId || s.locationId === locationId)) held.set(s.itemId, (held.get(s.itemId) ?? 0) + s.qty);
  const rows: StockValueRow[] = [];
  let total = 0;
  for (const i of items) {
    const q = held.get(i.id) ?? 0;
    const cost = i.units[0]?.cost;
    total += (cost ?? 0) * q;
    if (q <= 0) continue;
    const d = defaultUnitOf(i);
    rows.push({
      itemId: i.id,
      nameEn: i.nameEn,
      nameKn: i.nameKn,
      active: i.active,
      baseQty: q,
      baseUnit: i.units[0]?.code ?? '',
      unit: d.code,
      qty: r2(q / d.perBase),
      unitCost: cost == null ? null : Math.round(cost * d.perBase * 10000) / 10000,
      value: r2((cost ?? 0) * q),
      noCost: cost == null,
    });
  }
  rows.sort((a, b) => b.value - a.value || a.nameEn.localeCompare(b.nameEn));
  return { rows, total, noCost: rows.filter((r) => r.noCost).length };
}

export type SeriesBy = 'day' | 'month';

export interface SeriesPoint {
  /** YYYY-MM-DD or YYYY-MM, in the shop's time (IST). */
  key: string;
  amount: number;
  /** Base units sold (one item), or 0 for all sales. */
  qty: number;
  /** Bills (all sales) or bill lines (one item). */
  count: number;
}

const IST = 5.5 * 3600_000;
/** The shop day (IST) of an instant, YYYY-MM-DD. */
export const istDayOf = (iso: string | number) => new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + IST).toISOString().slice(0, 10);

/** The buckets, oldest first: the last 30 shop days, or the last 12 months, to now. */
export function seriesKeys(by: SeriesBy, now = Date.now()): string[] {
  const today = istDayOf(now);
  const keys: string[] = [];
  if (by === 'day') {
    const t = Date.parse(today + 'T00:00:00Z');
    for (let i = 29; i >= 0; i--) keys.push(new Date(t - i * 86_400_000).toISOString().slice(0, 10));
  } else {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7)) - 1;
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      keys.push(d.toISOString().slice(0, 7));
    }
  }
  return keys;
}

/**
 * Sales over time. All sales: each bill's total, as Home's week chart. One item: its linked lines
 * (amount and base quantity), leaving out lines still to confirm or not stock, as the reports do.
 * Cancelled bills never count.
 */
export function salesSeries(bills: Pick<BillMirror, 'at' | 'total' | 'cancelled' | 'lines'>[], by: SeriesBy, itemId?: string, now = Date.now()): SeriesPoint[] {
  const pts = seriesKeys(by, now).map((key) => ({ key, amount: 0, qty: 0, count: 0 }));
  const slot = new Map(pts.map((p) => [p.key, p]));
  const len = by === 'day' ? 10 : 7;
  for (const b of bills) {
    if (b.cancelled) continue;
    const p = slot.get(istDayOf(b.at).slice(0, len));
    if (!p) continue;
    if (!itemId) {
      p.amount += b.total;
      p.count++;
      continue;
    }
    for (const l of b.lines ?? []) {
      if (l.itemId !== itemId || !l.baseQty || l.state === 'to-confirm' || l.state === 'not-item') continue;
      p.amount += l.amount;
      p.qty += l.baseQty;
      p.count++;
    }
  }
  for (const p of pts) {
    p.amount = r2(p.amount);
    p.qty = r2(p.qty);
  }
  return pts;
}
