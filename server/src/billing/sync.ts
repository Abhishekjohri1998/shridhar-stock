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
  /** Only on a newer billing server's light list (lite=1): the bill has handwriting, left out of the list. */
  hasInk?: boolean;
  /** Billing's round-off and rounded total, on a newer billing server (either spelling is read). */
  roundOff?: number;
  roundoff?: number;
  rounded?: number;
  roundedTotal?: number;
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

/** One billing line as stock sees it. Existing lines keep what a person decided. */
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
  // What billing's given is taken to be: a draft tick billing missed is sent there (SyncResult.sendGiven).
  let seen = given;
  if (drafted && drafted.at) seen = fetched = drafted.fetched;
  else if (given !== lastGiven) fetched = given;
  const { fetched: _f, billingGiven: _g, ...rest } = line;
  return { ...rest, ...(fetched ? { fetched: true } : {}), ...(seen ? { billingGiven: true } : {}) };
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
  const moreInk = ink ? inks.slice(1) : [];
  const base: MirrorLine = {
    i,
    name: text,
    ...(ink ? { ink, inked: true } : {}),
    ...(moreInk.length ? { moreInk } : {}),
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
  return base; // handwritten, or a typed name no item has: waits for a person in To confirm
}

export interface SyncResult {
  bills: number;
  newBills: number;
  posted: number;
  reversed: number;
  toConfirm: number;
  customers: number;
  /** Draft ticks billing has not got yet; link.ts sends them through push.ts. */
  sendGiven: { no: number; i: number; given: boolean }[];
  /** Whether billing answered the light list (hasInk on each bill); false for an older billing server. */
  lite?: boolean;
  /** Full bills fetched one by one, for their handwriting. */
  fullFetched?: number;
}

export interface SyncOptions {
  /**
   * 'fast': only bills after `since` (new bills), the cheap read made every few seconds.
   * 'full': the latest `limit` bills, for cancels and edits of bills already read.
   * An older billing server ignores since and lite, and sends its latest bills in full either way.
   */
  mode?: 'fast' | 'full';
  /** The newest bill number stock already has. */
  since?: number;
  limit?: number;
  /** Read billing's customers too. The link does it on full reads and when a new bill arrives. */
  customers?: boolean;
}

/** The round-off as billing names it, under either spelling. Undefined when billing sent none. */
function billRounding(b: BillingBill): { roundOff?: number; rounded?: number } {
  const raw = b as unknown as Record<string, unknown>;
  const off = raw.roundOff ?? raw.roundoff;
  const rounded = raw.rounded ?? raw.roundedTotal;
  const out: { roundOff?: number; rounded?: number } = {};
  if (typeof off === 'number' && Number.isFinite(off)) out.roundOff = Math.round(off * 100) / 100;
  if (typeof rounded === 'number' && Number.isFinite(rounded)) out.rounded = Math.round(rounded * 100) / 100;
  // One without the other: the missing one follows from the total.
  if (out.roundOff != null && out.rounded == null) out.rounded = Math.round((b.total + out.roundOff) * 100) / 100;
  if (out.rounded != null && out.roundOff == null) out.roundOff = Math.round((out.rounded - b.total) * 100) / 100;
  return out;
}

/** JSON with sorted keys, so two copies of a bill compare equal whatever order their fields were set in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v as object)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}

/** The bill list from billing: the light one where billing has it, and whether it did. */
async function readBills(billing: BillingClient, opts: Required<Pick<SyncOptions, 'mode' | 'since' | 'limit'>>): Promise<{ bills: BillingBill[]; lite: boolean }> {
  const q = opts.mode === 'fast' && opts.since > 0 ? '?lite=1&since=' + opts.since + '&limit=' + opts.limit : '?lite=1&limit=' + opts.limit;
  const bills = await billing.get<BillingBill[]>('/api/bills' + q);
  // A billing server that knows lite marks every bill with hasInk; an older one sends full bills.
  const lite = bills.length > 0 && bills.every((b) => typeof b.hasInk === 'boolean');
  return { bills, lite };
}

/** Every customer from billing, written only where something changed. Returns how many were read. */
export async function syncCustomers(repo: InvRepo, billing: BillingClient): Promise<number> {
  const customers = await billing.get<BillingCustomer[]>('/api/customers');
  for (const c of customers) {
    const key = c.phone || c.id;
    const before = await repo.getDoc<CustomerProfile>('customers', 'c_' + key);
    const next: CustomerProfile = {
      id: 'c_' + key,
      key,
      name: c.name,
      ...(c.nameKn ? { nameKn: c.nameKn } : {}),
      billingId: c.id,
      ...(c.address ? { address: c.address } : before?.address ? { address: before.address } : {}),
      // Stock's own addition for deliveries, kept across syncs.
      ...(before?.landmark ? { landmark: before.landmark } : {}),
      // The home's map pin, also stock's own.
      ...(before?.lat != null && before?.lng != null ? { lat: before.lat, lng: before.lng } : {}),
      balance: c.balance ?? 0,
    };
    if (!before || stable(before) !== stable(next)) await repo.putDoc<CustomerProfile>('customers', next);
  }
  return customers.length;
}

/**
 * Reads bills (and, when asked, every customer) from billing, and brings stock up to date.
 *
 * - A matched line posts a sale from the shop (key sale:<bill>:<line>, so a restart or a second
 *   run never posts it again).
 * - A cancelled bill posts the reverse of every sale it made (key cancel:<bill>:<line>).
 * - Handwritten and unmatched lines wait in "To confirm".
 * - From a newer billing server the list comes without handwriting; a new bill that has some is
 *   fetched on its own, once. A bill already read keeps the handwriting it was read with.
 * - A bill that has not changed since the last read is not written again.
 */
export async function syncOnce(repo: InvRepo, billing: BillingClient, limitOrOpts: number | SyncOptions = 100): Promise<SyncResult> {
  const opts = typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts;
  const mode = opts.mode ?? 'full';
  const limit = opts.limit ?? (mode === 'full' ? 30 : 100);
  const wantCustomers = opts.customers ?? mode === 'full';
  const [{ bills: listed, lite }, items, locs] = await Promise.all([
    readBills(billing, { mode, since: opts.since ?? 0, limit }),
    repo.listItems(),
    repo.listLocations(),
  ]);
  const shop = locs.find((l) => l.kind === 'shop');
  if (!shop) throw new Error('No shop place');
  const result: SyncResult = { bills: listed.length, newBills: 0, posted: 0, reversed: 0, toConfirm: 0, customers: 0, sendGiven: [], lite, fullFetched: 0 };

  if (wantCustomers) result.customers = await syncCustomers(repo, billing);

  // Oldest first, so sales post in the order they were made.
  const ordered = [...listed].sort((a, b) => a.no - b.no);
  for (const listedBill of ordered) {
    const id = String(listedBill.no);
    const before = await repo.getDoc<BillMirror>('bills', id);
    let b = listedBill;
    // Read in full (an older server, or fetched below): every ink block is in hand.
    let whole = !lite;
    // A light bill with handwriting that stock has not read yet: its handwriting, fetched once.
    if (lite && b.hasInk && !before?.hasInk) {
      b = await billing.get<BillingBill>('/api/bills/' + b.no);
      result.fullFetched!++;
      whole = true;
    }
    if (!before) result.newBills++;
    // A bill saved from a live draft takes the draft's place, with the ticks made on it.
    const draft = b.draftId && !before ? takeDraft(b.draftId) : undefined;
    // Each line finds its draft line by billing's line id (the draft's key), else by position.
    const drafted = (l: BillingBill['lines'][number], i: number) =>
      before || !draft ? undefined : l.itemId ? draft.lines.find((d) => d.key === l.itemId) : draft.lines[i];
    const lines = b.lines.map((l, i) => {
      // A light line comes without its handwriting: the ink read before stays.
      const raw = lite && !l.ink && before?.lines[i]?.ink ? { ...l, ink: before.lines[i]!.ink, moreInk: before.lines[i]!.moreInk } : l;
      return toMirrorLine(items, raw, i, before?.lines[i], drafted(l, i));
    });
    // A tick made on the draft in the moment before Save may not have reached billing: send it.
    lines.forEach((l, i) => {
      if (!!l.billingGiven !== !!b.lines[i]!.given) result.sendGiven.push({ no: b.no, i, given: !!l.billingGiven });
    });
    const inked = lines.some((l) => l.ink);
    const mirror: BillMirror = {
      id,
      no: b.no,
      at: b.at,
      ...(b.customer ? { customer: { key: b.customer.phone || b.customer.id, name: b.customer.name, phone: b.customer.phone } } : {}),
      lines,
      ...(whole || before?.inkV ? { inkV: 2 } : {}),
      total: b.total,
      paid: b.paid,
      balance: b.balance,
      ...(b.cancelled ? { cancelled: true } : {}),
      // Removed from To digitise by the admin: billing knows nothing of it, so the mark is carried over.
      ...(before?.dismissed ? { dismissed: true, dismissedBy: before.dismissedBy, dismissedAt: before.dismissedAt } : {}),
      hasInk: inked,
      inkLines: lines.filter((l) => l.ink).length,
      ...billRounding(b),
    };
    // Nothing changed since the last read: nothing to write and nothing to post.
    if (before && stable(before) === stable(mirror)) {
      if (!b.cancelled && !mirror.dismissed) result.toConfirm += lines.filter((l) => l.state === 'to-confirm').length;
      continue;
    }

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
      if (!mirror.dismissed) result.toConfirm += lines.filter((l) => l.state === 'to-confirm').length;
    } else {
      // Only what was actually sold comes back: reverse the sale moves that exist.
      const sold = await repo.listMoves({});
      const reverse: StockMove[] = sold
        .filter((m) => m.kind === 'sale' || m.kind === 'digitise')
        .filter((m) => m.key.startsWith('sale:' + b.no + ':'))
        .map((m) => ({ id: 'mv_cancel_' + m.key, key: 'cancel:' + m.key.slice(5), at: new Date().toISOString(), kind: 'cancel', itemId: m.itemId, to: m.from!, qty: m.qty, ref: 'bill ' + b.no + ' cancelled', by: 'billing' }));
      result.reversed += (await post(repo, reverse)).length;
    }
    // Written after its stock moves: a read that fails half way is done again in full next time.
    await repo.putDoc('bills', mirror);
  }
  return result;
}

/**
 * Bills read before hasInk existed: marked once, at start, so Home can count handwriting by
 * query. Reads only the bills with no mark, a batch at a time.
 */
export async function markInk(repo: InvRepo, batch = 500): Promise<number> {
  let done = 0;
  for (;;) {
    const old = await repo.listDocs<BillMirror>('bills', { filter: { inkLines: { exists: false } }, limit: batch });
    if (!old.length) return done;
    for (const b of old) {
      for (const l of b.lines) if (l.ink) l.inked = true;
      b.hasInk = b.lines.some((l) => l.ink);
      b.inkLines = b.lines.filter((l) => l.ink).length;
    }
    await repo.putDocs('bills', old);
    done += old.length;
  }
}

/**
 * Bills read before stock kept every ink block (moreInk): each one still waiting in To digitise
 * with handwriting is read again in full from billing, once, and marked inkV: 2. Safe to run any
 * number of times; a bill billing cannot give now is tried again on the next run.
 * Returns how many bills were done, 0 when none are left, -1 when billing could not be read.
 */
export async function backfillMoreInk(repo: InvRepo, billing: BillingClient, batch = 50): Promise<number> {
  const filter = { hasInk: true, 'lines.state': 'to-confirm', cancelled: { ne: true }, inkV: { ne: 2 } };
  const todo = await repo.listDocs<BillMirror>('bills', { filter, limit: batch });
  let done = 0;
  for (const bill of todo) {
    let full: BillingBill;
    try {
      full = await billing.get<BillingBill>('/api/bills/' + bill.no);
    } catch {
      return done || -1; // billing away: the rest wait for the next run
    }
    bill.lines = bill.lines.map((l) => {
      const raw = full.lines?.[l.i];
      if (!raw || !l.ink) return l;
      const more = (raw.moreInk ?? []).filter((x): x is Ink => hasInk(x));
      // Billing may keep the first row in moreInk when ink itself is empty: the first stays as stored.
      const rest = hasInk(raw.ink) ? more : more.slice(1);
      const { moreInk: _m, ...keep } = l;
      return rest.length ? { ...keep, moreInk: rest } : keep;
    });
    bill.inkV = 2;
    await repo.putDoc('bills', bill);
    done++;
  }
  return done;
}

/** The link's health, for the admin's screens. */
export async function recordLink(repo: InvRepo, ok: boolean, detail: { lastBillNo?: number; message: string }): Promise<void> {
  const meta = (await repo.getDoc<{ id: string; link?: unknown }>('meta', 'status')) ?? { id: 'status' };
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
