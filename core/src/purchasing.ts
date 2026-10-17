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

export const ITEM_SORTS = ['name', 'price', 'stock', 'selling', 'category', 'expiry'] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

export interface SortFacts {
  /** Total stock in base units. */
  total: Map<string, number>;
  /** Sold in the last 30 days, in base units. */
  sold: Map<string, number>;
  /** Soonest expiry, YYYY-MM-DD. */
  expiry: Map<string, string>;
  /** Price of one selling unit. */
  price: (i: Item) => number;
  lang?: 'en' | 'kn';
}

/**
 * The list in the chosen order: name A–Z, price low to high, stock low to high (what to buy
 * first), highest selling first, category A–Z, expiry soonest first (items with no lot last).
 * Ties fall back to the name.
 */
export function sortItems<T extends Item>(items: T[], by: ItemSort, f: SortFacts): T[] {
  const name = (i: Item) => ((f.lang === 'kn' && i.nameKn) || i.nameEn || i.nameKn || '').toLowerCase();
  const byName = (a: Item, b: Item) => name(a).localeCompare(name(b));
  const cmp: Record<ItemSort, (a: T, b: T) => number> = {
    name: byName,
    price: (a, b) => f.price(a) - f.price(b),
    stock: (a, b) => (f.total.get(a.id) ?? 0) - (f.total.get(b.id) ?? 0),
    selling: (a, b) => (f.sold.get(b.id) ?? 0) - (f.sold.get(a.id) ?? 0),
    category: (a, b) => {
      const x = (a.category ?? '').toLowerCase();
      const y = (b.category ?? '').toLowerCase();
      if (x === y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y);
    },
    expiry: (a, b) => {
      const x = f.expiry.get(a.id);
      const y = f.expiry.get(b.id);
      if (x === y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y);
    },
  };
  return [...items].sort((a, b) => cmp[by](a, b) || byName(a, b));
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
