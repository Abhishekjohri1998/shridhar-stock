/*
 * Buying and moving goods in (agent B): carriers and their trips, the landed cost of what is
 * received, expiry lots used first-expiring-first, the product list's sorts, and the pop-up
 * calculator's evaluator. All pure, so the server, the website and the tests share them.
 */
import { round2, round4 } from './money';
import type { Item, ItemUnit } from './types';

// ------------------------------------------------------------------ carriers

/** A goods carrier: the daily vehicle that brings goods from suppliers who do not deliver. */
export interface Carrier {
  id: string;
  /** Owner or driver. */
  name: string;
  phone?: string;
  vehicleNo?: string;
  notes?: string;
  active: boolean;
}

/** One thing a trip brought. `value` is what it cost, when known, so the charge is shared by value. */
export interface CarrierTripLine {
  itemId: string;
  unit: string;
  qty: number;
  value?: number;
}

/** One trip: when, which carrier, from which supplier, what it brought and what it charged. */
export interface CarrierTrip {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  carrierId: string;
  supplierId?: string;
  lines: CarrierTripLine[];
  /** The delivery charge, in rupees. */
  charge: number;
  /** The purchase order whose receipt this trip's charge went into. */
  poId?: string;
  at: string;
}

/** A contact person at a supplier. */
export interface SupplierContact {
  name: string;
  role?: string;
  phone?: string;
}

/**
 * A delivery charge shared across lines: by value when every line has one, else by quantity.
 * Paise are rounded, and whatever rounding leaves goes to the last line, so the shares add up to
 * the charge exactly.
 */
export function splitCharge(lines: { qty: number; value?: number }[], charge: number): number[] {
  if (!lines.length || !(charge > 0)) return lines.map(() => 0);
  const byValue = lines.every((l) => (l.value ?? 0) > 0);
  const weights = lines.map((l) => (byValue ? l.value! : Math.max(0, l.qty)));
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return lines.map((_, i) => (i === lines.length - 1 ? round2(charge) : 0));
  const out = weights.map((w) => round2((charge * w) / sum));
  const diff = round2(charge - out.reduce((s, v) => s + v, 0));
  out[out.length - 1] = round2(out[out.length - 1]! + diff);
  return out;
}

/** What one unit really cost: (what was paid for the line + its delivery share) ÷ quantity. */
export function landedUnitCost(costPerUnit: number, qty: number, share: number): number {
  if (!(qty > 0)) return round4(costPerUnit);
  return round4((costPerUnit * qty + share) / qty);
}

/**
 * Every unit's cost from the landed cost of one unit: per base = cost ÷ perBase, each other unit
 * = per base × its perBase. The unit bought in keeps its own cost to the paisa.
 */
export function unitCostsFrom(units: ItemUnit[], code: string, cost: number): ItemUnit[] {
  const u = units.find((x) => x.code.toLowerCase() === code.toLowerCase());
  if (!u || !(u.perBase > 0)) return units;
  const perBase = cost / u.perBase;
  return units.map((x) => ({ ...x, cost: x === u ? round2(cost) : x.perBase === 1 ? round4(perBase) : round2(perBase * x.perBase) }));
}

// ------------------------------------------------------------------ expiry lots

/** Stock received with an expiry date, at one place, in base units. */
export interface Lot {
  id: string;
  itemId: string;
  /** A place id, or "transit:<ref>" while a transfer carries it. */
  placeId: string;
  qty: number;
  /** YYYY-MM-DD. */
  expiry: string;
  receivedAt: string;
  ref?: string;
}

/**
 * Takes `qty` out of lots, earliest expiry first. Never refuses: stock without a lot simply has
 * none to take from. Returns the lots as they are after, and what was taken from each.
 */
export function consumeFefo(lots: Lot[], qty: number): { after: Lot[]; taken: { lot: Lot; qty: number }[] } {
  let left = qty;
  const sorted = [...lots].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.receivedAt.localeCompare(b.receivedAt));
  const taken: { lot: Lot; qty: number }[] = [];
  const after = sorted.map((l) => {
    if (left <= 1e-9 || l.qty <= 0) return l;
    const t = Math.min(l.qty, left);
    left = Math.round((left - t) * 1000) / 1000;
    taken.push({ lot: l, qty: t });
    return { ...l, qty: Math.round((l.qty - t) * 1000) / 1000 };
  });
  return { after, taken };
}

/** YYYY-MM-DD, `days` after a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lots with stock left that expire on or before `days` after today (already expired included), soonest first. */
export function expiringWithin(lots: Lot[], today: string, days: number): Lot[] {
  const until = addDays(today, days);
  return lots.filter((l) => l.qty > 0 && !l.placeId.startsWith('transit:') && l.expiry <= until).sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** Each item's soonest expiry among lots with stock left. */
export function soonestExpiry(lots: Lot[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of lots) {
    if (!(l.qty > 0)) continue;
    const cur = m.get(l.itemId);
    if (!cur || l.expiry < cur) m.set(l.itemId, l.expiry);
  }
  return m;
}

// ------------------------------------------------------------------ the product list's sorts

export const ITEM_SORTS = ['name', 'price', 'stock', 'selling', 'expiry', 'category', 'volatility', 'place'] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];
export type SortDir = 'asc' | 'desc';

/** The order each sort starts in: A–Z, cheapest, least stock, best selling, soonest expiry, most changed price. */
export const DEFAULT_SORT_DIR: Record<ItemSort, SortDir> = {
  name: 'asc',
  price: 'asc',
  stock: 'asc',
  selling: 'desc',
  expiry: 'asc',
  category: 'asc',
  volatility: 'desc',
  // Storage place: most at that place first.
  place: 'desc',
};

/** How often an item's selling price moved: changes between consecutive sales, and (max − min) / avg. */
export interface PriceVolatility {
  changes: number;
  spread: number;
}

export interface SortFacts {
  /** Total stock in base units. */
  total: Map<string, number>;
  /** Sold in the last 30 days, in base units. */
  sold: Map<string, number>;
  /** Soonest expiry, YYYY-MM-DD. */
  expiry: Map<string, string>;
  /** Price of one selling unit. */
  price: (i: Item) => number;
  /** Price changes in the last 90 days. */
  volatility?: Map<string, PriceVolatility>;
  lang?: 'en' | 'kn';
}

/**
 * The list in the chosen order and direction (default per sort: DEFAULT_SORT_DIR). Items with
 * nothing to sort by (no expiry, no category) stay last either way. Ties fall back to the name A–Z.
 */
export function sortItems<T extends Item>(items: T[], by: ItemSort, f: SortFacts, dir: SortDir = DEFAULT_SORT_DIR[by]): T[] {
  const name = (i: Item) => ((f.lang === 'kn' && i.nameKn) || i.nameEn || i.nameKn || '').toLowerCase();
  const byName = (a: Item, b: Item) => name(a).localeCompare(name(b));
  const sign = dir === 'desc' ? -1 : 1;
  /** Ascending compare of optional text; blanks last whatever the direction. */
  const text = (x: string | undefined, y: string | undefined) => {
    if ((x ?? '') === (y ?? '')) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return sign * x.localeCompare(y);
  };
  const vol = (i: Item) => f.volatility?.get(i.id) ?? { changes: 0, spread: 0 };
  const cmp: Record<ItemSort, (a: T, b: T) => number> = {
    name: (a, b) => sign * byName(a, b),
    price: (a, b) => sign * (f.price(a) - f.price(b)),
    stock: (a, b) => sign * ((f.total.get(a.id) ?? 0) - (f.total.get(b.id) ?? 0)),
    selling: (a, b) => sign * ((f.sold.get(a.id) ?? 0) - (f.sold.get(b.id) ?? 0)),
    category: (a, b) => text((a.category ?? '').toLowerCase(), (b.category ?? '').toLowerCase()),
    expiry: (a, b) => text(f.expiry.get(a.id), f.expiry.get(b.id)),
    volatility: (a, b) => sign * (vol(a).changes - vol(b).changes || vol(a).spread - vol(b).spread),
    // Outside a place (a search), by total stock like 'stock'.
    place: (a, b) => sign * ((f.total.get(a.id) ?? 0) - (f.total.get(b.id) ?? 0)),
  };
  return [...items].sort((a, b) => cmp[by](a, b) || byName(a, b));
}

/**
 * Per item, from mirrored bills (not cancelled), oldest first: how many times the line rate of
 * the same unit changed from one sale to the next, and the widest (max − min) / avg of those
 * rates over its units, rounded to 3 places. Lines with no item, "not stock" or no rate are skipped.
 */
export function priceVolatility(bills: { at: string; cancelled?: boolean; lines: { itemId?: string; unit?: string; rate: number; state?: string }[] }[]): Map<string, PriceVolatility> {
  const seen = new Map<string, number[]>();
  for (const b of [...bills].sort((x, y) => x.at.localeCompare(y.at))) {
    if (b.cancelled) continue;
    for (const l of b.lines ?? []) {
      if (!l.itemId || l.state === 'not-item' || !(l.rate > 0)) continue;
      const k = l.itemId + '\u0000' + (l.unit ?? '').toLowerCase();
      const a = seen.get(k) ?? [];
      a.push(l.rate);
      seen.set(k, a);
    }
  }
  const out = new Map<string, PriceVolatility>();
  for (const [k, rates] of seen) {
    const id = k.split('\u0000')[0]!;
    let changes = 0;
    for (let i = 1; i < rates.length; i++) if (Math.abs(rates[i]! - rates[i - 1]!) > 1e-9) changes++;
    const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
    const spread = Math.round(((Math.max(...rates) - Math.min(...rates)) / avg) * 1000) / 1000;
    const cur = out.get(id) ?? { changes: 0, spread: 0 };
    out.set(id, { changes: cur.changes + changes, spread: Math.max(cur.spread, spread) });
  }
  return out;
}

// ------------------------------------------------------------------ the calculator

/**
 * Works out a small sum: + − × ÷ (also - * / and x), brackets, decimals and %. No eval: a small
 * recursive-descent parser. "a + b%" is a plus b percent of a, "a − b%" likewise, and "a × b%" is
 * b percent of a, as on a shop calculator. Returns null for anything it cannot read, or ÷ 0.
 */
export function calc(input: string): number | null {
  const s = input.replace(/[×xX]/g, '*').replace(/[÷]/g, '/').replace(/[−–]/g, '-').replace(/,/g, '').replace(/\s+/g, '');
  if (!s || s.length > 200) return null;
  let i = 0;
  const peek = () => s[i];
  const fail = (): never => {
    throw new Error('bad');
  };
  /** A number or a bracket, with any leading signs, and whether a % followed it. */
  function factor(): { v: number; pct: boolean } {
    const c = peek();
    if (c === '-' || c === '+') {
      i++;
      const f = factor();
      return { v: c === '-' ? -f.v : f.v, pct: f.pct };
    }
    let v: number;
    if (c === '(') {
      i++;
      v = expr();
      if (peek() !== ')') fail();
      i++;
    } else {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) return fail();
      i += m[0].length;
      v = Number(m[0]);
    }
    if (peek() === '%') {
      i++;
      return { v, pct: true };
    }
    return { v, pct: false };
  }
  function term(): { v: number; pct: boolean } {
    let left = factor();
    let lv = left.pct ? left.v / 100 : left.v;
    let single = true;
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = factor();
      const rv = r.pct ? r.v / 100 : r.v;
      if (op === '*') lv *= rv;
      else {
        if (rv === 0) fail();
        lv /= rv;
      }
      single = false;
    }
    // A lone "b%" in a sum is kept as a percent, for a + b% to mean a plus b% of a.
    if (single && left.pct) return { v: left.v, pct: true };
    return { v: lv, pct: false };
  }
  function expr(): number {
    const first = term();
    let v = first.pct ? first.v / 100 : first.v;
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      const rv = r.pct ? (v * r.v) / 100 : r.v;
      v = op === '+' ? v + rv : v - rv;
    }
    return v;
  }
  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return Math.round(v * 1e8) / 1e8;
  } catch {
    return null;
  }
}

/** The calculator sheet's full height: title, sum, answer, five rows of keys and "Put in box". */
export const CALC_SHEET_FULL_H = 480;

/**
 * Where the calculator sheet sits for a window of w × h (the layout viewport, not the visual
 * one: the sheet closes the phone keyboard, so a keyboard-shrunk visualViewport is ignored).
 * Narrow screens get a bottom sheet, wider ones a centred box. It is always tall enough for the
 * whole keypad (height, its least), may grow to room, and only scrolls inside when the window
 * itself is shorter than the keypad.
 */
export function calcSheetLayout(w: number, h: number): { mode: 'bottom' | 'center'; height: number; room: number; scroll: boolean } {
  const mode = w < 640 ? 'bottom' : 'center';
  const room = Math.max(0, Math.floor(h - (mode === 'center' ? 32 : 8)));
  const height = Math.min(CALC_SHEET_FULL_H, room);
  return { mode, height, room, scroll: room < CALC_SHEET_FULL_H };
}

// ------------------------------------------------------------------ vendor history: delivery, checklists, payments

/** Who brings an order: the vendor themselves, or a goods carrier from the Carriers list. */
export type DeliveryMode = 'self' | 'carrier';
export const DELIVERY_MODES = ['self', 'carrier'] as const;

export interface PoDelivery {
  mode: DeliveryMode;
  carrierId?: string;
  vehicleNo?: string;
  driverName?: string;
  /** YYYY-MM-DD. */
  expectedOn?: string;
  /** When the shop marked it "on the way". */
  onWayAt?: string;
}

export const PAY_METHODS = ['cash', 'upi', 'bank', 'credit'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export interface PoPayment {
  id: string;
  at: string;
  amount: number;
  method: PayMethod;
  note?: string;
  by?: string;
}

export const CHECK_CONDITIONS = ['ok', 'damaged', 'short'] as const;
export type CheckCondition = (typeof CHECK_CONDITIONS)[number];

/** One line of a delivery checklist: what was still due, what arrived, ticked, and its state. */
export interface ChecklistLine {
  itemId: string;
  /** Still due on the order when this delivery came, in the order's unit. */
  ordered: number;
  arrived: number;
  /** Ticked as checked. */
  ok: boolean;
  condition: CheckCondition;
  note?: string;
}

export interface DeliveryChecklist {
  id: string;
  at: string;
  by: string;
  mode: DeliveryMode;
  carrierId?: string;
  vehicleNo?: string;
  driverName?: string;
  /** The carrier and vehicle were checked against the order. */
  carrierConfirmed?: boolean;
  /** Which receipt of the order this was (1, 2, ...). */
  receipt: number;
  lines: ChecklistLine[];
}

/** What arrived of one line in one receipt. */
export interface ReceivedLine {
  itemId: string;
  qty: number;
  cost: number;
  delivery?: number;
  landed?: number;
  expiry?: string;
  places?: { placeId: string; qty: number }[];
  receipt?: number;
}

type PoLike = {
  status: string;
  at: string;
  lines: { itemId: string; qty: number; cost: number }[];
  received?: ReceivedLine[];
  payments?: PoPayment[];
  billTotal?: number;
  delivery?: PoDelivery;
};

/** All that arrived of an item on an order, over every receipt. */
export function receivedQty(p: Pick<PoLike, 'received'>, itemId: string): number {
  return Math.round((p.received ?? []).filter((r) => r.itemId === itemId).reduce((n, r) => n + r.qty, 0) * 1e6) / 1e6;
}

export type PoProgress = 'ordered' | 'on_way' | 'part' | 'received' | 'cancelled';

/** Ordered → On the way → Part received → Received (or Cancelled). */
export function poProgress(p: PoLike): PoProgress {
  if (p.status === 'cancelled') return 'cancelled';
  if (p.status === 'received') return 'received';
  if ((p.received ?? []).some((r) => r.qty > 0)) return 'part';
  if (p.delivery?.onWayAt) return 'on_way';
  return 'ordered';
}

/**
 * The bill and what is left to pay. The bill is the vendor's invoice total when typed in; else
 * what arrived at its cost plus the delivery charge; before anything arrives, what was ordered
 * (so an advance can be paid). A cancelled order with nothing received owes nothing.
 */
export function poBill(p: PoLike): { billTotal: number; paid: number; pending: number } {
  const rec = p.received ?? [];
  const worked = rec.length
    ? rec.reduce((s, r) => s + r.qty * r.cost + (r.delivery ?? 0), 0)
    : p.status === 'cancelled'
      ? 0
      : p.lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const billTotal = round2(p.billTotal ?? worked);
  const paid = round2((p.payments ?? []).reduce((s, x) => s + x.amount, 0));
  return { billTotal, paid, pending: round2(Math.max(0, billTotal - paid)) };
}

/** A payment shared over orders oldest first, each taking up to what it still owes. */
export function allocateOldestFirst(orders: { id: string; at: string; pending: number }[], amount: number): { id: string; amount: number }[] {
  let left = round2(amount);
  const out: { id: string; amount: number }[] = [];
  for (const o of [...orders].sort((a, b) => a.at.localeCompare(b.at))) {
    if (left <= 0) break;
    if (!(o.pending > 0)) continue;
    const take = round2(Math.min(o.pending, left));
    out.push({ id: o.id, amount: take });
    left = round2(left - take);
  }
  return out;
}

/** A supplier's totals over its orders (cancelled ones left out): bought, paid, pending, last purchase. */
export function supplierSummary(pos: PoLike[]): { bought: number; paid: number; pending: number; orders: number; lastPurchase: string | null } {
  const live = pos.filter((p) => p.status !== 'cancelled');
  let bought = 0;
  let paid = 0;
  let pending = 0;
  for (const p of live) {
    const b = poBill(p);
    bought += b.billTotal;
    paid += b.paid;
    pending += b.pending;
  }
  const last = live.map((p) => p.at).sort().pop() ?? null;
  return { bought: round2(bought), paid: round2(paid), pending: round2(pending), orders: live.length, lastPurchase: last };
}
