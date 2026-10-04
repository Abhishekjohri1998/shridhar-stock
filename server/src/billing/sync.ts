import {
  hasInk,
  priceFor,
  searchKey,
  unitKey,
  type BillMirror,
  type CustomerProfile,
  type Ink,
  type Item,
  type MirrorLine,
  type StockMove,
} from '@stock/core';
import { post } from '../posting';
import type { InvRepo } from '../store/types';
import type { BillingClient } from './client';
import { takeDraft, type Draft } from './drafts';

/** A bill as the billing server sends it. Only the fields stock reads. */
export interface BillingBill {
  no: number;
  at: string;
  customer?: { id: string; name: string; nameKn?: string; phone: string };
  lines: {
    nameKn?: string;
    nameEn?: string;
    ink?: Ink;
    moreInk?: Ink[];
    lastMode?: 'ink' | 'text';
    qty: number;
    rate: number;
    /** Set when the line was picked from stock's items while billing: exact, no guessing. */
    stockItemId?: string;
    /** Billing's own id for the line: the same as the draft line's key. */
    itemId?: string;
    unit?: string;
    /** Billing's own given tick. */
    given?: boolean;
  }[];
  total: number;
  paid: number;
  balance: number;
  cancelled?: boolean;
  /** The live draft this bill was written as, when billing sent one. */
  draftId?: string;
}

export interface BillingCustomer {
  id: string;
  name: string;
  nameKn?: string;
  phone: string;
  address?: string;
  balance?: number;
}

/**
 * Which item a typed name means: its name, or another name it is billed as, in either script.
 * Only an exact match on the whole name counts, and only when exactly one item has it; anything
 * less goes to a person, because a wrong match silently moves the wrong stock.
 *
 * A leading quantity or unit is allowed around the name: "Sugar 2kg", "2 kg sugar".
 */
export function matchTyped(items: Item[], text: string): { item: Item; unit?: string } | null {
  const words = String(text ?? '').trim().toLowerCase();
  if (!words) return null;
  const stripped = words
    .replace(/\b\d+(\.\d+)?\s*(kg|g|gm|l|ltr|ml|pc|pcs)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const keys = new Set([searchKey(words), searchKey(stripped)].filter(Boolean));
  const hits: { item: Item; unit?: string }[] = [];
  for (const item of items) {
    if (!item.active) continue;
    const names: { text: string; unit?: string }[] = [{ text: item.nameEn }, { text: item.nameKn }, ...item.aliases];
    const hit = names.find((n) => n.text && keys.has(searchKey(n.text)));
    if (hit) hits.push({ item, ...(hit.unit ? { unit: hit.unit } : {}) });
  }
  return hits.length === 1 ? hits[0]! : null;
}

/** Picks the unit a billed rate fits best, when the name did not say one. */
function unitForRate(item: Item, qty: number, rate: number, named?: string): string {
  // A unit billing names, by its code or its label, is taken as it is.
  const said = named ? item.units.find((u) => unitKey(u.code) === unitKey(named) || unitKey(u.label) === unitKey(named)) : undefined;
  if (said) return said.code;
  let best = item.units[0]!.code;
  let bestGap = Infinity;
  for (const u of item.units) {
    const gap = Math.abs(priceFor(item, u.code, qty).rate - rate);
    if (gap < bestGap) {
      bestGap = gap;
      best = u.code;
    }
  }
  return best;
}

/** One billing line as stock sees it. Existing lines keep what a person or the reader decided. */
function toMirrorLine(items: Item[], raw: BillingBill['lines'][number], i: number, before?: MirrorLine, drafted?: Draft['lines'][number]): MirrorLine {
  const line = matchLine(items, raw, i, before);
  /*
   * The fetched tick. A draft's tick carries over when the bill is saved. After that, billing's
   * given is compared with what the last sync saw: if the counter changed it there, that wins;
   * otherwise the worker's tick here stands.
   */
  const given = !!raw.given;
  const lastGiven = before ? !!before.billingGiven : false;
  let fetched = !!line.fetched;
  if (drafted && drafted.at) fetched = drafted.fetched;
  else if (given !== lastGiven) fetched = given;
  const { fetched: _f, billingGiven: _g, ...rest } = line;
  return { ...rest, ...(fetched ? { fetched: true } : {}), ...(given ? { billingGiven: true } : {}) };
}

function matchLine(items: Item[], raw: BillingBill['lines'][number], i: number, before?: MirrorLine): MirrorLine {
  /*
   * Billing fills both names when only one was typed ("Sugar 2kg" in English and Kannada alike),
   * so the two are de-duplicated, and each is tried on its own for a match.
   */
  const names = raw.lastMode === 'ink' ? [] : [...new Set([raw.nameEn, raw.nameKn].map((n) => String(n ?? '').trim()).filter(Boolean))];
  const text = names.join(' / ');
  const inks = [raw.ink, ...(raw.moreInk ?? [])].filter((x): x is Ink => hasInk(x));
  const ink = raw.lastMode === 'text' ? undefined : inks[0];
  const base: MirrorLine = {
    i,
    name: text,
    ...(ink ? { ink } : {}),
    qty: raw.qty,
    rate: raw.rate,
    amount: Math.round(raw.qty * raw.rate * 100) / 100,
    state: 'to-confirm',
  };
  if (before && before.state !== 'to-confirm') {
    return { ...base, state: before.state, itemId: before.itemId, unit: before.unit, baseQty: before.baseQty, reading: before.reading, fetched: before.fetched };
  }
  if (before?.reading) base.reading = before.reading;
  if (before?.fetched) base.fetched = before.fetched;
  if (!text && !ink) return { ...base, state: 'not-item' }; // a price with nothing written
  // Picked from stock's own list while billing: the item is known exactly.
  const picked = raw.stockItemId ? items.find((x) => x.id === raw.stockItemId && x.active) : undefined;
  if (picked) {
    const unit = unitForRate(picked, raw.qty, raw.rate, raw.unit);
    return { ...base, state: 'typed-match', itemId: picked.id, unit, baseQty: priceFor(picked, unit, raw.qty).baseQty };
  }
  if (names.length) {
    const m = names.map((n) => matchTyped(items, n)).find((x) => x) ?? null;
    if (m) {
      const unit = unitForRate(m.item, raw.qty, raw.rate, raw.unit ?? m.unit);
      return { ...base, state: 'typed-match', itemId: m.item.id, unit, baseQty: priceFor(m.item, unit, raw.qty).baseQty };
    }
  }
  return base; // handwritten, or a typed name no item has: waits for the reader or a person
}

export interface SyncResult {
  bills: number;
  newBills: number;
  posted: number;
  reversed: number;
  toConfirm: number;
  customers: number;
}

/**
 * Reads the latest bills and every customer from billing, and brings stock up to date.
 *
 * - A matched line posts a sale from the shop (key sale:<bill>:<line>, so a restart or a second
 *   run never posts it again).
 * - A cancelled bill posts the reverse of every sale it made (key cancel:<bill>:<line>).
 * - Handwritten and unmatched lines wait in "To confirm".
 */
export async function syncOnce(repo: InvRepo, billing: BillingClient, limit = 100): Promise<SyncResult> {
  const [bills, customers, items, locs] = await Promise.all([
    billing.get<BillingBill[]>('/api/bills?limit=' + limit),
    billing.get<BillingCustomer[]>('/api/customers'),
    repo.listItems(),
    repo.listLocations(),
  ]);
  const shop = locs.find((l) => l.kind === 'shop');
  if (!shop) throw new Error('No shop place');
  const result: SyncResult = { bills: bills.length, newBills: 0, posted: 0, reversed: 0, toConfirm: 0, customers: 0 };

  for (const c of customers) {
    const key = c.phone || c.id;
    const before = await repo.getDoc<CustomerProfile>('customers', 'c_' + key);
    await repo.putDoc<CustomerProfile>('customers', {
      id: 'c_' + key,
      key,
      name: c.name,
      ...(c.nameKn ? { nameKn: c.nameKn } : {}),
      billingId: c.id,
      ...(c.address ? { address: c.address } : before?.address ? { address: before.address } : {}),
      // Stock's own addition for deliveries, kept across syncs.
      ...(before?.landmark ? { landmark: before.landmark } : {}),
      balance: c.balance ?? 0,
    });
    result.customers++;
  }

  for (const b of bills) {
    const id = String(b.no);
    const before = await repo.getDoc<BillMirror>('bills', id);
    if (!before) result.newBills++;
    // A bill saved from a live draft takes the draft's place, with the ticks made on it.
    const draft = b.draftId ? takeDraft(b.draftId) : undefined;
    // Each line finds its draft line by billing's line id (the draft's key), else by position.
    const drafted = (l: BillingBill['lines'][number], i: number) =>
      before || !draft ? undefined : l.itemId ? draft.lines.find((d) => d.key === l.itemId) : draft.lines[i];
    const lines = b.lines.map((l, i) => toMirrorLine(items, l, i, before?.lines[i], drafted(l, i)));
    const mirror: BillMirror = {
      id,
      no: b.no,
      at: b.at,
      ...(b.customer ? { customer: { key: b.customer.phone || b.customer.id, name: b.customer.name, phone: b.customer.phone } } : {}),
      lines,
      total: b.total,
      paid: b.paid,
      balance: b.balance,
      ...(b.cancelled ? { cancelled: true } : {}),
    };
    await repo.putDoc('bills', mirror);

    const moved = lines.filter((l) => l.itemId && l.baseQty && (l.state === 'typed-match' || l.state === 'read-auto' || l.state === 'confirmed'));
    if (!b.cancelled) {
      const sales: StockMove[] = moved.map((l) => ({
        id: 'mv_sale_' + b.no + '_' + l.i,
        key: 'sale:' + b.no + ':' + l.i,
        at: b.at,
        kind: 'sale',
        itemId: l.itemId!,
        from: shop.id,
        qty: l.baseQty!,
        ref: 'bill ' + b.no + ' line ' + (l.i + 1),
        by: 'billing',
      }));
      result.posted += (await post(repo, sales)).length;
      result.toConfirm += lines.filter((l) => l.state === 'to-confirm').length;
    } else {
      // Only what was actually sold comes back: reverse the sale moves that exist.
      const sold = await repo.listMoves({});
      const reverse: StockMove[] = sold
        .filter((m) => m.kind === 'sale' || m.kind === 'digitise')
        .filter((m) => m.key.startsWith('sale:' + b.no + ':'))
        .map((m) => ({ id: 'mv_cancel_' + m.key, key: 'cancel:' + m.key.slice(5), at: new Date().toISOString(), kind: 'cancel', itemId: m.itemId, to: m.from!, qty: m.qty, ref: 'bill ' + b.no + ' cancelled', by: 'billing' }));
      result.reversed += (await post(repo, reverse)).length;
    }
  }
  return result;
}

/** The link's health, for the admin's screens. */
export async function recordLink(repo: InvRepo, ok: boolean, detail: { lastBillNo?: number; message: string }): Promise<void> {
  const meta = (await repo.getDoc<{ id: string; link?: unknown; reader?: unknown }>('meta', 'status')) ?? { id: 'status' };
  const prev = (meta.link ?? {}) as { lastOkAt?: string };
  await repo.putDoc('meta', {
    ...meta,
    link: {
      ok,
      at: new Date().toISOString(),
      ...(ok ? { lastOkAt: new Date().toISOString() } : prev.lastOkAt ? { lastOkAt: prev.lastOkAt } : {}),
      ...detail,
    },
  });
}

/**
 * How often billing is read. Quickly while the counter is busy, so a bill reaches the worker's
 * pick list within seconds of being saved; slowly when the shop is quiet, to spare both servers.
 */
export const POLL_BUSY_MS = 3_000;
export const POLL_IDLE_MS = 15_000;
/** A bill made or changed this recently means the counter is busy. */
export const POLL_ACTIVE_WINDOW_MS = 10 * 60_000;

/**
 * The wait before the next read: busy while a bill is still open at the counter (one made in
 * the last ten minutes) or a recent read brought something new; idle otherwise.
 */
export function pollDelay(
  bills: Pick<BillMirror, 'at' | 'cancelled'>[],
  lastChangeAt: number,
  now = Date.now(),
  ms: { busy: number; idle: number; window: number } = { busy: POLL_BUSY_MS, idle: POLL_IDLE_MS, window: POLL_ACTIVE_WINDOW_MS },
): number {
  const since = now - ms.window;
  const busy = lastChangeAt >= since || bills.some((b) => !b.cancelled && Date.parse(b.at) >= since);
  return busy ? ms.busy : ms.idle;
}
