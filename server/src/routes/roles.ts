import { Router } from 'express';
import { z } from 'zod';
import {
  isLow,
  OPEN_PO,
  proposeRefill,
  totalsByItem,
  roundOff,
  type BillMirror,
  type CustomerProfile,
  type Item,
  type PurchaseOrder,
  type Transfer,
  type Vehicle,
} from '@stock/core';
import { requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { emit } from '../events';
import { dataVersion, getRepo } from '../store';
import { onEmit } from '../events';
import { placeOrder, settingsOf } from '../setup';
import { listDrafts, tickDraft } from '../billing/drafts';
import { matchTyped } from '../billing/sync';
import { pushGiven } from '../billing/push';
import type { LowAlert } from '../posting';

/**
 * What each role reads, and the small things each may do.
 *
 * Every answer is built for its role here, never a full record with fields taken off afterwards:
 * a godown's stock is assembled without prices. Which records a person may see is decided from who they are on the server, never
 * from anything the page sends.
 */
export const roleRoutes = Router();

const admin = requireRole('admin');

/** A shop day starts at midnight in India. */
export function istToday(now = Date.now()): string {
  const d = new Date(now + 5.5 * 3600_000);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 5.5 * 3600_000).toISOString();
}

const byNoDesc = <T extends { no: number }>(a: T, b: T) => b.no - a.no;

function rounding(total: number, step: number): { rounded: number; roundOff: number } {
  const r = roundOff(total, step);
  return { rounded: r.rounded, roundOff: r.diff };
}

// ---------------------------------------------------------------- admin

/** Stock value at cost: each item's base cost times what all places hold, in one pass. */
export function stockValueOf(items: Pick<Item, 'id' | 'units'>[], stock: { itemId: string; qty: number }[]): number {
  const held = new Map<string, number>();
  for (const s of stock) if (s.qty > 0) held.set(s.itemId, (held.get(s.itemId) ?? 0) + s.qty);
  let sum = 0;
  for (const i of items) sum += (i.units[0]?.cost ?? 0) * (held.get(i.id) ?? 0);
  return sum;
}

const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * Everything Home shows, in one light call. Only recent bills are read (the last seven days, for
 * the cards and the chart); waiting lines and money due are found by query, not by reading every
 * bill. The answer is kept in memory until something changes: any write through the store or any
 * live event clears it, and it is never kept past a minute, since "today" and "the last day" move.
 */
let homeCache: { version: number; at: number; body: unknown } | null = null;
onEmit(() => {
  homeCache = null;
});
const HOME_TTL_MS = 60_000;

export async function buildHome() {
  const repo = getRepo();
  const today = istToday();
  // Seven shop days, today last.
  const weekStart = istToday(Date.now() - 6 * 86_400_000);
  const live = { cancelled: { ne: true } };
  const [items, stock, week, waiting, owing, handwritten, transfers, pos, meta, alerts] = await Promise.all([
    repo.listItems(),
    repo.listStock(),
    repo.listDocs<Pick<BillMirror, 'id' | 'at' | 'total' | 'cancelled'>>('bills', { filter: { at: { gte: weekStart } }, fields: ['at', 'total', 'cancelled'] }),
    repo.listDocs<Pick<BillMirror, 'id' | 'lines'>>('bills', { filter: { ...live, 'lines.state': 'to-confirm' }, fields: ['lines'] }),
    repo.listDocs<Pick<BillMirror, 'id' | 'balance'>>('bills', { filter: { ...live, balance: { gt: 0 } }, fields: ['balance'] }),
    repo.listDocs<Pick<BillMirror, 'id' | 'lines'>>('bills', { filter: { ...live, 'lines.ink': { exists: true } }, fields: ['lines'] }),
    repo.listDocs<Pick<Transfer, 'id' | 'status'>>('transfers', { filter: { status: ['sent', 'requested'] }, fields: ['status'] }),
    repo.listDocs<Pick<PurchaseOrder, 'id'>>('pos', { filter: { status: [...OPEN_PO] }, fields: ['status'] }),
    repo.getDoc<{ id: string; link?: unknown }>('meta', 'status'),
    repo.getDoc<{ id: string; list: LowAlert[] }>('meta', 'lowAlerts'),
  ]);
  const totals = totalsByItem(stock);
  const lowItems = items.filter((i) => i.active && isLow(i, totals.get(i.id) ?? 0));
  const stillLow = new Set(lowItems.map((i) => i.id));
  const names = new Map(items.map((i) => [i.id, i]));
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const justLow = (alerts?.list ?? [])
    .filter((a) => a.at >= since && stillLow.has(a.itemId))
    .slice(0, 8)
    .map((a) => ({ ...a, nameEn: names.get(a.itemId)?.nameEn ?? '', nameKn: names.get(a.itemId)?.nameKn ?? '' }));
  const todays = week.filter((b) => b.at >= today && !b.cancelled);
  const days: { day: string; total: number; bills: number }[] = [];
  for (let i = 6; i >= 0; i--) days.push({ day: istDay(new Date(Date.now() - i * 86_400_000).toISOString()), total: 0, bills: 0 });
  const slot = new Map(days.map((d) => [d.day, d]));
  for (const b of week) {
    if (b.cancelled) continue;
    const d = slot.get(istDay(b.at));
    if (d) {
      d.total += b.total;
      d.bills += 1;
    }
  }
  return {
    toConfirm: waiting.reduce((n, b) => n + b.lines.filter((l) => l.state === 'to-confirm').length, 0),
    low: lowItems.length,
    justLow,
    negative: new Set(stock.filter((s) => s.qty < 0).map((s) => s.itemId)).size,
    inTransit: transfers.filter((t) => t.status === 'sent').length,
    requested: transfers.filter((t) => t.status === 'requested').length,
    openPos: pos.length,
    salesToday: todays.reduce((s, b) => s + b.total, 0),
    billsToday: todays.length,
    due: owing.reduce((s, b) => s + Math.max(0, b.balance), 0),
    stockValue: stockValueOf(items, stock),
    handwrittenLines: handwritten.reduce((n, b) => n + b.lines.filter((l) => l.ink).length, 0),
    link: meta?.link ?? null,
    week: days,
  };
}

roleRoutes.get(
  '/admin/home',
  admin,
  handler(async (_req, res) => {
    const now = Date.now();
    const v = dataVersion();
    if (!homeCache || homeCache.version !== v || now - homeCache.at > HOME_TTL_MS) {
      const body = await buildHome();
      // Only kept if nothing was written while it was being read.
      homeCache = dataVersion() === v ? { version: v, at: now, body } : null;
      res.json(body);
      return;
    }
    res.json(homeCache.body);
  }),
);

/** The older, fuller summary. Home reads /admin/home; this stays for anything else that asks. */
roleRoutes.get(
  '/admin/summary',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, stock, bills, transfers, pos, meta, alerts] = await Promise.all([
      repo.listItems(),
      repo.listStock(),
      repo.listDocs<BillMirror>('bills'),
      repo.listDocs<Transfer>('transfers'),
      repo.listDocs<PurchaseOrder>('pos', { status: [...OPEN_PO] }),
      repo.getDoc<{ id: string; link?: unknown }>('meta', 'status'),
      repo.getDoc<{ id: string; list: LowAlert[] }>('meta', 'lowAlerts'),
    ]);
    // Running low is all places together, the same rule as Inventory and the buy list.
    const totals = totalsByItem(stock);
    const lowItems = items.filter((i) => i.active && isLow(i, totals.get(i.id) ?? 0));
    const low = lowItems.length;
    const stillLow = new Set(lowItems.map((i) => i.id));
    const names = new Map(items.map((i) => [i.id, i]));
    // What went low in the last day and is still low: the sales that did it, newest first.
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const justLow = (alerts?.list ?? [])
      .filter((a) => a.at >= since && stillLow.has(a.itemId))
      .slice(0, 8)
      .map((a) => ({ ...a, nameEn: names.get(a.itemId)?.nameEn ?? '', nameKn: names.get(a.itemId)?.nameKn ?? '' }));
    const today = istToday();
    const todays = bills.filter((b) => b.at >= today && !b.cancelled);
    const lines = bills.flatMap((b) => (b.cancelled ? [] : b.lines));
    const written = lines.filter((l) => l.ink);
    res.json({
      toConfirm: lines.filter((l) => l.state === 'to-confirm').length,
      low,
      justLow,
      negative: new Set(stock.filter((s) => s.qty < 0).map((s) => s.itemId)).size,
      inTransit: transfers.filter((t) => t.status === 'sent').length,
      requested: transfers.filter((t) => t.status === 'requested').length,
      openPos: pos.length,
      salesToday: todays.reduce((s, b) => s + b.total, 0),
      billsToday: todays.length,
      due: bills.filter((b) => !b.cancelled).reduce((s, b) => s + Math.max(0, b.balance), 0),
      stockValue: stockValueOf(items, stock),
      handwrittenLines: written.length,
      link: meta?.link ?? null,
    });
  }),
);

roleRoutes.get(
  '/admin/bills',
  admin,
  handler(async (req, res) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const repo = getRepo();
    const [bills, settings] = await Promise.all([repo.listDocs<BillMirror>('bills', { sort: { no: -1 }, limit }), settingsOf(repo)]);
    // The total as the counter collects it, with the round-off line that gets there.
    res.json(bills.map((b) => ({ ...b, ...rounding(b.total, settings.roundTo) })));
  }),
);

/** Every handwritten or unmatched line waiting for a person, oldest first. */
roleRoutes.get(
  '/admin/confirm',
  admin,
  handler(async (_req, res) => {
    const bills = await getRepo().listDocs<BillMirror>('bills', { filter: { cancelled: { ne: true }, 'lines.state': 'to-confirm' }, sort: { no: 1 } });
    res.json(
      bills.flatMap((b) =>
        b.lines
          .filter((l) => l.state === 'to-confirm')
          .map((l) => ({ billNo: b.no, at: b.at, customer: b.customer?.name ?? '', line: l })),
      ),
    );
  }),
);

roleRoutes.get(
  '/admin/refill',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, stock, locs] = await Promise.all([repo.listItems(), repo.listStock(), repo.listLocations()]);
    res.json(proposeRefill(items, stock, locs));
  }),
);

/**
 * Purchase orders, open ones first and newest first within each, a page at a time. Open orders are read
 * with a query, so a long history of received ones costs nothing until "Show more" reaches it.
 */
roleRoutes.get(
  '/admin/pos',
  admin,
  handler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const repo = getRepo();
    const open = (await repo.listDocs<PurchaseOrder>('pos', { status: [...OPEN_PO] })).sort(byNoDesc);
    let orders = open.slice(offset, offset + limit);
    let total = open.length;
    if (req.query.open !== '1') {
      const closed = (await repo.listDocs<PurchaseOrder>('pos', { status: ['received', 'cancelled'] })).sort(byNoDesc);
      total += closed.length;
      if (orders.length < limit) orders = [...orders, ...closed.slice(Math.max(0, offset - open.length), Math.max(0, offset - open.length) + limit - orders.length)];
    }
    // Names and units of just the items on this page, so the screen need not read the catalogue.
    const want = new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)));
    const items = (await repo.listItems())
      .filter((i) => want.has(i.id))
      .map((i) => ({ id: i.id, nameEn: i.nameEn, nameKn: i.nameKn, units: i.units.map((u) => ({ code: u.code, label: u.label, labelKn: u.labelKn, perBase: u.perBase })) }));
    res.json({ orders, items, open: open.length, total, next: offset + orders.length < total ? offset + orders.length : null });
  }),
);

for (const [path, col] of [
  ['/admin/transfers', 'transfers'],
  ['/admin/suppliers', 'suppliers'],
  ['/admin/customers', 'customers'],
] as const) {
  roleRoutes.get(
    path,
    admin,
    handler(async (_req, res) => {
      const docs = await getRepo().listDocs<{ id: string; no?: number; at?: string }>(col);
      docs.sort((a, b) => (b.no ?? 0) - (a.no ?? 0) || String(b.at ?? '').localeCompare(String(a.at ?? '')));
      res.json(docs);
    }),
  );
}

// ---------------------------------------------------------------- shop worker

/**
 * Today's bills, newest first, each line with where it is kept in the shop. Bills still being
 * written at the counter come first, marked draft, so the worker can start walking before Save.
 */
roleRoutes.get(
  '/worker/bills',
  requireRole('worker', 'godown', 'admin'),
  handler(async (_req, res) => {
    const repo = getRepo();
    const today = istToday();
    const [bills, items, locs, settings] = await Promise.all([
      repo.listDocs<BillMirror>('bills', { filter: { at: { gte: today }, cancelled: { ne: true } } }),
      repo.listItems(),
      repo.listLocations(),
      settingsOf(repo),
    ]);
    const places = placeOrder(locs.filter((l) => l.active));
    const byId = new Map(items.map((i) => [i.id, i]));
    /** Where to fetch it from: the shop's rack if it has one, else the first godown that does. */
    const keptAt = (item: Item | undefined) => {
      const i = item ? places.findIndex((p) => (item.racks[p.id] ?? '').trim()) : -1;
      return i < 0 ? { rack: '' } : { place: places[i]!.name, placeOrder: i, rack: item!.racks[places[i]!.id]!.trim() };
    };
    const active = items.filter((i) => i.active);
    const drafts = listDrafts().map((d) => {
      const total = Math.round(d.lines.reduce((s, l) => s + l.qty * l.rate, 0) * 100) / 100;
      return {
        no: 0,
        draftId: d.draftId,
        at: new Date(d.updatedAt).toISOString(),
        customer: d.customerName,
        total,
        ...rounding(total, settings.roundTo),
        lines: d.lines.map((l, i) => {
          const name = [l.nameKn, l.nameEn].map((n) => n.trim()).filter(Boolean).filter((n, k, all) => all.indexOf(n) === k).join(' / ');
          // Picked from stock's list at the counter, else the same exact-name match a saved bill gets.
          const item = (l.stockItemId ? byId.get(l.stockItemId) : undefined) ?? (name ? (matchTyped(active, l.nameEn || l.nameKn) ?? matchTyped(active, l.nameKn))?.item : undefined);
          return {
            i,
            name,
            ...(typeof l.ink === 'object' ? { ink: l.ink } : {}),
            qty: l.qty,
            itemId: item?.id,
            itemName: item ? [item.nameKn, item.nameEn].filter(Boolean).join(' · ') : '',
            unit: l.unit,
            ...keptAt(item),
            fetched: l.fetched,
          };
        }),
      };
    });
    res.json([
      ...drafts,
      ...bills
        .filter((b) => b.at >= today && !b.cancelled)
        // Newest first by the time it was made: the bill just written is the one to fetch.
        .sort((a, b) => b.at.localeCompare(a.at) || b.no - a.no)
        .map((b) => ({
          no: b.no,
          at: b.at,
          customer: b.customer?.name ?? '',
          total: b.total,
          ...rounding(b.total, settings.roundTo),
          lines: b.lines.map((l) => {
            // Until a person confirms it, the best match says which rack to walk to.
            const guess = l.itemId ?? l.reading?.itemId;
            const item = guess ? byId.get(guess) : undefined;
            return {
              i: l.i,
              name: l.name,
              ink: l.ink,
              qty: l.qty,
              readText: l.reading?.readText,
              itemId: l.itemId,
              itemName: item ? [item.nameKn, item.nameEn].filter(Boolean).join(' · ') : '',
              unit: l.unit,
              baseQty: l.baseQty,
              ...keptAt(item),
              fetched: !!l.fetched,
            };
          }),
        })),
    ]);
  }),
);

roleRoutes.post(
  '/worker/bills/:no/lines/:i/fetched',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const { fetched } = z.object({ fetched: z.boolean() }).parse(req.body);
    const repo = getRepo();
    const bill = await repo.getDoc<BillMirror>('bills', String(req.params.no));
    if (!bill) throw new HttpError(404, 'No such bill');
    const line = bill.lines.find((l) => l.i === Number(req.params.i));
    if (!line) throw new HttpError(404, 'No such line');
    const changed = !!line.fetched !== fetched;
    line.fetched = fetched;
    await repo.putDoc('bills', bill);
    emit('bills', {}, String(bill.no));
    // Billing's given tick follows, in the background.
    if (changed) void pushGiven(bill.no, line.i, fetched);
    res.json({ ok: true });
  }),
);

/** Select all, or select none: every line of one bill ticked or unticked at once. */
roleRoutes.post(
  '/worker/bills/:no/fetched',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const { fetched } = z.object({ fetched: z.boolean() }).parse(req.body);
    const repo = getRepo();
    const bill = await repo.getDoc<BillMirror>('bills', String(req.params.no));
    if (!bill) throw new HttpError(404, 'No such bill');
    const changed = bill.lines.filter((l) => !!l.fetched !== fetched);
    for (const l of bill.lines) l.fetched = fetched;
    await repo.putDoc('bills', bill);
    for (const l of changed) void pushGiven(bill.no, l.i, fetched);
    emit('bills', {}, String(bill.no));
    res.json({ ok: true, lines: bill.lines.length });
  }),
);

/** The same two ticks on a bill still being written. Billing reads them back with its next draft. */
roleRoutes.post(
  '/worker/drafts/:id/lines/:i/fetched',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const { fetched } = z.object({ fetched: z.boolean() }).parse(req.body);
    if (!tickDraft(String(req.params.id), Number(req.params.i), fetched)) throw new HttpError(404, 'No such draft line');
    res.json({ ok: true });
  }),
);

roleRoutes.post(
  '/worker/drafts/:id/fetched',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const { fetched } = z.object({ fetched: z.boolean() }).parse(req.body);
    if (!tickDraft(String(req.params.id), null, fetched)) throw new HttpError(404, 'No such draft');
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- vehicles

/**
 * The shop's vehicles, for the pick list on the transfer and dispatch forms. Number,
 * type and driver's name only: the driver's phone stays with the admin.
 */
roleRoutes.get(
  '/vehicles',
  requireRole('admin', 'worker', 'godown'),
  handler(async (_req, res) => {
    const all = await getRepo().listDocs<Vehicle>('vehicles');
    res.json(all.filter((v) => v.active).sort((a, b) => a.number.localeCompare(b.number)).map((v) => ({ number: v.number, type: v.type, driverName: v.driverName, ...(v.kind ? { kind: v.kind } : {}) })));
  }),
);

// ---------------------------------------------------------------- godown

/**
 * The godown the Godown tab is showing: the one asked for (?g=), else an old godown login's own,
 * else the first. Any worker may work any godown.
 */
async function myGodown(req: import('express').Request): Promise<string> {
  const godowns = placeOrder((await getRepo().listLocations()).filter((l) => l.active && l.kind === 'godown'));
  if (!godowns.length) throw new HttpError(404, 'There is no godown yet. Ask the admin to add one under Setup.');
  const want = String(req.query.g ?? '') || req.person!.linkedId || '';
  return (godowns.find((l) => l.id === want) ?? godowns[0]!).id;
}

/** The godowns, for the picker on the Godown tab. */
roleRoutes.get(
  '/godown/places',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const godowns = placeOrder((await getRepo().listLocations()).filter((l) => l.active && l.kind === 'godown'));
    res.json(godowns.map((l) => ({ id: l.id, name: l.name, nameKn: l.nameKn })));
  }),
);

roleRoutes.get(
  '/godown/transfers',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const g = await myGodown(req);
    const all = await getRepo().listDocs<Transfer>('transfers');
    res.json(all.filter((t) => t.from === g || t.to === g).sort(byNoDesc));
  }),
);

roleRoutes.get(
  '/godown/stock',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const g = await myGodown(req);
    const repo = getRepo();
    const [items, stock] = await Promise.all([repo.listItems(), repo.listStock()]);
    const here = new Map(stock.filter((s) => s.locationId === g).map((s) => [s.itemId, s.qty]));
    res.json(
      items
        .filter((i) => i.active)
        .map((i) => ({ itemId: i.id, nameEn: i.nameEn, nameKn: i.nameKn, units: i.units.map((u) => ({ code: u.code, labelKn: u.labelKn, perBase: u.perBase })), rack: i.racks[g] ?? '', qty: here.get(i.id) ?? 0 })),
    );
  }),
);

/** Names of the items on a godown's transfers, which the godown needs and may see. */
roleRoutes.get(
  '/godown/items',
  requireRole('worker', 'godown', 'admin'),
  handler(async (req, res) => {
    const g = await myGodown(req);
    const items = await getRepo().listItems();
    res.json(items.map((i) => ({ id: i.id, nameEn: i.nameEn, nameKn: i.nameKn, units: i.units.map((u) => ({ code: u.code, label: u.label, labelKn: u.labelKn, perBase: u.perBase, price: 0 })), rack: i.racks[g] ?? '' })));
  }),
);
