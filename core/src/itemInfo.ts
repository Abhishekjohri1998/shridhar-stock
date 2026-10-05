import { round2, round3 } from './money';
import { findUnit } from './units';
import type { Item, PurchaseOrder, StockMove } from './types';

/**
 * A supplier of one item: added by hand on the item, found in past purchase orders, or both.
 * `lastCost` is per `lastUnit`, from the newest order that had the item (a received one first).
 */
export interface ItemSupplierRow {
  supplierId: string;
  manual: boolean;
  lastCost?: number;
  lastUnit?: string;
  lastAt?: string;
  /** How many orders had this item from this supplier, cancelled ones left out. */
  orders: number;
}

/** When an order happened: received if it was, else when it was placed. */
const poAt = (po: PurchaseOrder) => po.times.received ?? po.at;

/**
 * Everyone who supplies an item, the usual one first: the one most recently bought from, then
 * the hand-added ones that were never ordered from, in the order they were added.
 */
export function itemSuppliers(item: Pick<Item, 'id' | 'suppliers'>, pos: PurchaseOrder[]): ItemSupplierRow[] {
  const rows = new Map<string, ItemSupplierRow>();
  for (const id of item.suppliers ?? []) rows.set(id, { supplierId: id, manual: true, orders: 0 });
  const sorted = pos.filter((p) => p.status !== 'cancelled').sort((a, b) => poAt(a).localeCompare(poAt(b)));
  for (const po of sorted) {
    const line = po.lines.find((l) => l.itemId === item.id);
    if (!line) continue;
    const r = rows.get(po.supplierId) ?? { supplierId: po.supplierId, manual: false, orders: 0 };
    r.orders++;
    r.lastCost = line.cost;
    r.lastUnit = line.unit;
    r.lastAt = poAt(po);
    rows.set(po.supplierId, r);
  }
  const all = [...rows.values()];
  const bought = all.filter((r) => r.lastAt).sort((a, b) => b.lastAt!.localeCompare(a.lastAt!));
  return [...bought, ...all.filter((r) => !r.lastAt)];
}

/** The usual supplier of every item at once, for the buy list: item id to supplier id. */
export function usualSuppliers(items: Pick<Item, 'id' | 'suppliers'>[], pos: PurchaseOrder[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    const first = itemSuppliers(it, pos)[0];
    if (first) m.set(it.id, first.supplierId);
  }
  return m;
}

export interface StockInfo {
  /** All places together, in base units. */
  total: number;
  /** What it is all worth at what it costs the shop, when a cost is known. */
  valueAtCost?: number;
  lastBought?: { at: string; supplierId: string; cost: number; unit: string; qty: number };
  lastSold?: { at: string; qty: number };
  /** Sold in the last 30 days, in base units. */
  sold30: number;
  /** At the last 30 days' rate; absent when nothing sold. */
  daysLeft?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * The summary at the top of an item's Stock tab. Cost is per base unit from the cheapest way to
 * say it: the base unit's own cost, or a bigger unit's cost spread over what it holds.
 */
export function stockInfo(item: Item, total: number, moves: StockMove[], pos: PurchaseOrder[], now = Date.now()): StockInfo {
  const costUnit = item.units.find((u) => u.cost != null);
  const perBaseCost = costUnit ? costUnit.cost! / costUnit.perBase : undefined;
  const sales = moves.filter((m) => m.itemId === item.id && m.kind === 'sale').sort((a, b) => b.at.localeCompare(a.at));
  // A cancelled bill gives its stock back; the 30-day rate counts what really left.
  const since = now - 30 * DAY;
  const recent = (k: string) => moves.filter((m) => m.itemId === item.id && m.kind === k && Date.parse(m.at) >= since).reduce((s, m) => s + m.qty, 0);
  const sold30 = round3(Math.max(0, recent('sale') - recent('cancel')));
  let lastBought: StockInfo['lastBought'];
  for (const po of pos) {
    if (po.status !== 'received') continue;
    const line = po.lines.find((l) => l.itemId === item.id);
    if (!line) continue;
    const at = po.times.received ?? po.at;
    if (!lastBought || at > lastBought.at) lastBought = { at, supplierId: po.supplierId, cost: line.cost, unit: line.unit, qty: line.qty };
  }
  return {
    total,
    ...(perBaseCost != null ? { valueAtCost: round2(Math.max(0, total) * perBaseCost) } : {}),
    ...(lastBought ? { lastBought } : {}),
    ...(sales[0] ? { lastSold: { at: sales[0].at, qty: sales[0].qty } } : {}),
    sold30,
    ...(sold30 > 0 ? { daysLeft: Math.max(0, Math.floor(total / (sold30 / 30))) } : {}),
  };
}

/** The unit and cost to start a new purchase order line with: the default unit, at the last cost paid in it. */
export function poLineDefault(item: Item & { defaultUnit?: string }, rows: ItemSupplierRow[], supplierId?: string): { unit: string; cost?: number } {
  const unit = (item.defaultUnit && findUnit(item, item.defaultUnit)?.code) || item.units[0]!.code;
  const r = rows.find((x) => x.supplierId === supplierId && x.lastUnit === unit) ?? rows.find((x) => x.lastUnit === unit);
  const cost = r?.lastCost ?? findUnit(item, unit)?.cost;
  return { unit, ...(cost != null ? { cost } : {}) };
}
