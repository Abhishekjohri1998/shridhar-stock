import { defaultUnitOf, findUnit } from './units';
import type { BillMirror, Item, MirrorLine } from './types';

/**
 * What one bill line cost the shop: the line's unit cost (or the base cost times the unit's size)
 * times its quantity. The one cost basis for sales reports, charts and their profit. Null when the
 * item has no cost set, so profit can leave the line out instead of counting it as free.
 */
export function lineCost(item: Pick<Item, 'units'> | undefined, l: Pick<MirrorLine, 'unit' | 'qty' | 'baseQty'>): number | null {
  if (!item) return null;
  const unit = l.unit ? findUnit(item, l.unit) : undefined;
  if (unit?.cost != null) return unit.cost * l.qty;
  const base = item.units[0]?.cost;
  if (base == null) return null;
  return unit ? base * unit.perBase * l.qty : base * (l.baseQty ?? 0);
}

/** Profit and margin from sales and cost of the same lines; margin is a % of those sales. */
export function profitOf(sales: number, cost: number): { profit: number; margin: number | null } {
  const profit = r2(sales - cost);
  return { profit, margin: sales > 0 ? Math.round((profit / sales) * 1000) / 10 : null };
}

type Items = Map<string, Pick<Item, 'units'>>;

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
  /** Sales of the linked item lines whose cost is known, their cost, and the profit on them. */
  costedSales: number;
  cost: number;
  profit: number;
}

const IST = 5.5 * 3600_000;
/** The shop day (IST) of an instant, YYYY-MM-DD. */
export const istDayOf = (iso: string | number) => new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + IST).toISOString().slice(0, 10);

/** How many buckets a window holds: 30 days or 12 months. */
export const seriesSpan = (by: SeriesBy) => (by === 'day' ? 30 : 12);

/** One bucket key moved by n buckets (days or months). */
export function shiftKey(by: SeriesBy, key: string, n: number): string {
  if (by === 'day') return new Date(Date.parse(key + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1;
  return new Date(Date.UTC(y, m + n, 1)).toISOString().slice(0, 7);
}

const validKey = (by: SeriesBy, k: string) => (by === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(k) && !Number.isNaN(Date.parse((by === 'day' ? k : k + '-01') + 'T00:00:00Z'));

/**
 * The buckets, oldest first, like a bank statement window: 30 shop days or 12 months starting at
 * `start` (a day, or a month; a day given for months uses its month). With no start, or a start so
 * late the window would pass today, the window ends today: it never shows the future.
 */
export function seriesKeys(by: SeriesBy, now = Date.now(), start?: string): string[] {
  const today = istDayOf(now);
  const last = by === 'day' ? today : today.slice(0, 7);
  const n = seriesSpan(by);
  let first = shiftKey(by, last, -(n - 1));
  const st = start && by === 'month' && start.length === 10 ? start.slice(0, 7) : start;
  if (st && validKey(by, st) && st < first) first = st;
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(shiftKey(by, first, i));
  return keys;
}

/** The window before or after one (`dir` -1 or 1), as its start key; null when it would pass today. */
export function stepWindow(by: SeriesBy, start: string, dir: -1 | 1, now = Date.now()): string | null {
  const next = shiftKey(by, start, dir * seriesSpan(by));
  const latest = seriesKeys(by, now)[0]!;
  if (dir > 0 && next > latest) return start >= latest ? null : latest;
  return next;
}

/**
 * Sales over time. All sales: each bill's total, as Home's week chart. One item: its linked lines
 * (amount and base quantity), leaving out lines still to confirm or not stock, as the reports do.
 * Cancelled bills never count.
 */
export function salesSeries(bills: Pick<BillMirror, 'at' | 'total' | 'cancelled' | 'lines'>[], by: SeriesBy, itemId?: string, now = Date.now(), start?: string, items?: Items): SeriesPoint[] {
  const pts: SeriesPoint[] = seriesKeys(by, now, start).map((key) => ({ key, amount: 0, qty: 0, count: 0, costedSales: 0, cost: 0, profit: 0 }));
  const addCost = (p: SeriesPoint, l: MirrorLine) => {
    const c = lineCost(items?.get(l.itemId!), l);
    if (c == null) return;
    p.costedSales += l.amount;
    p.cost += c;
  };
  const slot = new Map(pts.map((p) => [p.key, p]));
  const len = by === 'day' ? 10 : 7;
  for (const b of bills) {
    if (b.cancelled) continue;
    const p = slot.get(istDayOf(b.at).slice(0, len));
    if (!p) continue;
    if (!itemId) {
      p.amount += b.total;
      p.count++;
      for (const l of b.lines ?? []) if (l.itemId && l.baseQty && l.state !== 'to-confirm' && l.state !== 'not-item') addCost(p, l);
      continue;
    }
    for (const l of b.lines ?? []) {
      if (l.itemId !== itemId || !l.baseQty || l.state === 'to-confirm' || l.state === 'not-item') continue;
      p.amount += l.amount;
      p.qty += l.baseQty;
      p.count++;
      addCost(p, l);
    }
  }
  for (const p of pts) {
    p.amount = r2(p.amount);
    p.qty = r2(p.qty);
    p.costedSales = r2(p.costedSales);
    p.cost = r2(p.cost);
    p.profit = r2(p.costedSales - p.cost);
  }
  return pts;
}

/** The first instant (ISO) of a bucket key in IST, and of the one after it. */
export function keyRange(by: SeriesBy, key: string): { from: string; to: string } {
  const at = (k: string) => new Date(Date.parse((by === 'day' ? k : k + '-01') + 'T00:00:00+05:30')).toISOString();
  return { from: at(key), to: at(shiftKey(by, key, 1)) };
}

export interface SalesDetails {
  keys: string[];
  amount: number;
  /** Bills with something counted. */
  bills: number;
  /** Base units (one item only). */
  qty: number;
  /** Sales of linked item lines, and of those whose cost is known: profit covers only those. */
  linkedSales: number;
  costedSales: number;
  cost: number;
  profit: number;
  /** Profit as a % of costedSales; null with nothing costed. */
  margin: number | null;
  /** Items sold in the period that have no cost set (left out of the profit). */
  noCostItems: number;
  /** Per item: base quantity and amount, biggest amount first (linked lines only); cost and profit null without a cost. */
  items: { itemId: string; qty: number; amount: number; lines: number; cost: number | null; profit: number | null }[];
  /** All sales: each bill; one item: each of its lines. Newest first. */
  rows: { billNo: number; at: string; total: number; qty: number; unit: string; rate: number; amount: number; cost: number | null; profit: number | null }[];
}

/**
 * What was sold in several buckets together (days or months, any mix of the chart's bars), the
 * same rules as salesSeries: cancelled bills never count; for one item only its linked lines.
 */
export function salesDetails(bills: Pick<BillMirror, 'no' | 'at' | 'total' | 'cancelled' | 'lines'>[], by: SeriesBy, keys: string[], itemId?: string, catalogue?: Items): SalesDetails {
  const want = new Set(keys.filter((k) => validKey(by, k)));
  const len = by === 'day' ? 10 : 7;
  const items = new Map<string, { itemId: string; qty: number; amount: number; lines: number; cost: number | null; profit: number | null }>();
  const out: SalesDetails = { keys: [...want].sort(), amount: 0, bills: 0, qty: 0, linkedSales: 0, costedSales: 0, cost: 0, profit: 0, margin: null, noCostItems: 0, items: [], rows: [] };
  const noCost = new Set<string>();
  for (const b of bills) {
    if (b.cancelled || !want.has(istDayOf(b.at).slice(0, len))) continue;
    let counted = false;
    for (const l of b.lines ?? []) {
      if (!l.itemId || !l.baseQty || l.state === 'to-confirm' || l.state === 'not-item') continue;
      if (itemId && l.itemId !== itemId) continue;
      const c = lineCost(catalogue?.get(l.itemId), l);
      const r = items.get(l.itemId) ?? { itemId: l.itemId, qty: 0, amount: 0, lines: 0, cost: 0, profit: 0 };
      r.qty = r2(r.qty + l.baseQty);
      r.amount = r2(r.amount + l.amount);
      r.lines++;
      if (c == null) {
        r.cost = null;
        noCost.add(l.itemId);
      } else if (r.cost != null) r.cost += c;
      items.set(l.itemId, r);
      out.linkedSales += l.amount;
      if (c != null) {
        out.costedSales += l.amount;
        out.cost += c;
      }
      if (itemId) {
        out.amount += l.amount;
        out.qty += l.baseQty;
        out.rows.push({ billNo: b.no, at: b.at, total: b.total, qty: l.qty, unit: l.unit ?? '', rate: l.rate, amount: l.amount, cost: c == null ? null : r2(c), profit: c == null ? null : r2(l.amount - c) });
        counted = true;
      }
    }
    if (!itemId) {
      out.amount += b.total;
      out.rows.push({ billNo: b.no, at: b.at, total: b.total, qty: 0, unit: '', rate: 0, amount: b.total, cost: null, profit: null });
      counted = true;
    }
    if (counted) out.bills++;
  }
  out.amount = r2(out.amount);
  out.qty = r2(out.qty);
  out.linkedSales = r2(out.linkedSales);
  out.costedSales = r2(out.costedSales);
  out.cost = r2(out.cost);
  Object.assign(out, profitOf(out.costedSales, out.cost));
  out.noCostItems = noCost.size;
  out.items = [...items.values()]
    .map((r) => (r.cost == null ? { ...r, profit: null } : { ...r, cost: r2(r.cost), profit: r2(r.amount - r.cost) }))
    .sort((a, b) => b.amount - a.amount);
  out.rows.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}
