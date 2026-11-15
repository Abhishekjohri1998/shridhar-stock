import { Router } from 'express';
import { findUnit, lineCost, priceFor, rateRange, roundOff, keyRange, salesDetails, salesSeries, sellUnitOf, seriesKeys, stockValueRows, toCsv, type BillMirror, type SeriesBy, type Delivery, type Item, type StockLevel, type Transfer, type Vehicle } from '@stock/core';
import { requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';
import { settingsOf } from '../setup';
import { vehicleKey } from './admin';

/**
 * Reports for the admin, worked out from the bills stock has read and the ledger.
 *
 * Honest about what they cannot see: a handwritten line nobody has confirmed yet has no item, so
 * "sales by item" says how much of the takings is still unlinked rather than quietly leaving it
 * out.
 */
export const reportRoutes = Router();

const readers = requireRole('admin');

function istDay(day: string, end = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Dates are YYYY-MM-DD');
  const t = Date.parse(day + 'T00:00:00+05:30') + (end ? 86_400_000 : 0);
  return new Date(t).toISOString();
}

function period(q: Record<string, unknown>): { from: string; to: string; days: number } {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const fromDay = String(q.from ?? '') || new Date(Date.now() + 5.5 * 3600_000 - 29 * 86_400_000).toISOString().slice(0, 10);
  const toDay = String(q.to ?? '') || today;
  const from = istDay(fromDay);
  const to = istDay(toDay, true);
  if (from >= to) throw new HttpError(400, 'The start is after the end');
  return { from, to, days: Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)) };
}

const name = (i: Item | undefined, id: string) => (i ? i.nameEn || i.nameKn : id);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SalesRow {
  itemId: string;
  name: string;
  nameKn: string;
  baseQty: number;
  amount: number;
  cost: number;
  lines: number;
}

export async function salesByItem(bills: BillMirror[], items: Map<string, Item>, from: string, to: string) {
  const rows = new Map<string, SalesRow>();
  let total = 0;
  let linked = 0;
  let unlinked = 0;
  let unlinkedLines = 0;
  let notStock = 0;
  for (const b of bills) {
    if (b.cancelled || b.at < from || b.at >= to) continue;
    for (const l of b.lines) {
      total += l.amount;
      if (l.state === 'not-item') {
        notStock += l.amount;
        continue;
      }
      if (!l.itemId || !l.baseQty || l.state === 'to-confirm') {
        unlinked += l.amount;
        unlinkedLines++;
        continue;
      }
      linked += l.amount;
      const it = items.get(l.itemId);
      const r = rows.get(l.itemId) ?? { itemId: l.itemId, name: name(it, l.itemId), nameKn: it?.nameKn ?? '', baseQty: 0, amount: 0, cost: 0, lines: 0 };
      r.baseQty += l.baseQty;
      r.amount = round2(r.amount + l.amount);
      r.cost = round2(r.cost + (lineCost(it, l) ?? 0));
      r.lines++;
      rows.set(l.itemId, r);
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.amount - a.amount),
    total: round2(total),
    linked: round2(linked),
    unlinked: round2(unlinked),
    unlinkedLines,
    notStock: round2(notStock),
  };
}

export function stockValue(items: Item[], stock: StockLevel[], locs: { id: string; name: string }[]) {
  const byItem = new Map(items.map((i) => [i.id, i]));
  const places = locs.map((l) => ({ id: l.id, name: l.name, value: 0, items: 0, negative: 0 }));
  for (const s of stock) {
    const it = byItem.get(s.itemId);
    const place = places.find((p) => p.id === s.locationId);
    if (!it || !place || s.qty === 0) continue;
    if (s.qty < 0) {
      place.negative++;
      continue;
    }
    const cost = it.units[0]?.cost ?? 0;
    place.value = round2(place.value + cost * s.qty);
    place.items++;
  }
  const noCost = items.filter((i) => i.active && i.units[0]?.cost == null).length;
  return { places, total: round2(places.reduce((s, p) => s + p.value, 0)), noCost };
}

export async function movers(bills: BillMirror[], items: Item[], stock: StockLevel[], from: string, to: string, days: number) {
  const sold = new Map<string, number>();
  for (const b of bills) {
    if (b.cancelled || b.at < from || b.at >= to) continue;
    for (const l of b.lines) if (l.itemId && l.baseQty && l.state !== 'to-confirm' && l.state !== 'not-item') sold.set(l.itemId, (sold.get(l.itemId) ?? 0) + l.baseQty);
  }
  const held = new Map<string, number>();
  for (const s of stock) held.set(s.itemId, (held.get(s.itemId) ?? 0) + Math.max(0, s.qty));
  const rows = items
    .filter((i) => i.active)
    .map((i) => {
      const q = sold.get(i.id) ?? 0;
      const perDay = q / days;
      const have = held.get(i.id) ?? 0;
      return { itemId: i.id, name: i.nameEn || i.nameKn, nameKn: i.nameKn, unit: i.units[0]!.code, sold: q, perDay: round2(perDay), have, daysLeft: perDay > 0 ? Math.round(have / perDay) : null };
    });
  return {
    fast: rows.filter((r) => r.sold > 0).sort((a, b) => b.perDay - a.perDay).slice(0, 15),
    // Slow: in stock, and sold least (or not at all) in the period.
    slow: rows.filter((r) => r.have > 0).sort((a, b) => a.perDay - b.perDay || b.have - a.have).slice(0, 15),
  };
}

/** Lines billed at a rate outside what the shop allows, or far from the item's price. */
export function outOfRange(bills: BillMirror[], items: Map<string, Item>, from: string, to: string) {
  const out: { billNo: number; at: string; line: number; itemId: string; name: string; unit: string; qty: number; rate: number; usual: number; why: 'low' | 'high' | 'far' }[] = [];
  for (const b of bills) {
    if (b.cancelled || b.at < from || b.at >= to) continue;
    for (const l of b.lines) {
      if (!l.itemId || !l.unit || l.state === 'to-confirm' || l.state === 'not-item') continue;
      const it = items.get(l.itemId);
      const unit = it ? findUnit(it, l.unit) : undefined;
      if (!it || !unit) continue;
      const usual = priceFor(it, l.unit, l.qty).rate;
      const r = rateRange(unit, l.rate);
      const far = usual > 0 && Math.abs(l.rate - usual) > usual * 0.15;
      if (r || far) out.push({ billNo: b.no, at: b.at, line: l.i + 1, itemId: it.id, name: it.nameEn || it.nameKn, unit: l.unit, qty: l.qty, rate: l.rate, usual, why: r ?? 'far' });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Trips each vehicle made in the period: transfers that left (sent or received) and deliveries
 * that went out. A vehicle typed as free text is counted under what was typed; one in the
 * vehicle list is counted under its number however it was spelt.
 */
export function tripsByVehicle(vehicles: Vehicle[], transfers: Transfer[], deliveries: Delivery[], from: string, to: string) {
  const rows = new Map<string, { vehicle: string; type: string; driver: string; transfers: number; deliveries: number }>();
  for (const v of vehicles) if (v.active) rows.set(vehicleKey(v.number), { vehicle: v.number, type: v.type, driver: v.driverName, transfers: 0, deliveries: 0 });
  const row = (text: string) => {
    const k = vehicleKey(text);
    const r = rows.get(k) ?? { vehicle: text.trim(), type: '', driver: '', transfers: 0, deliveries: 0 };
    rows.set(k, r);
    return r;
  };
  for (const t of transfers) {
    const at = t.times.sent ?? t.at;
    if (!t.vehicle || !vehicleKey(t.vehicle) || (t.status !== 'sent' && t.status !== 'received') || at < from || at >= to) continue;
    row(t.vehicle).transfers++;
  }
  for (const d of deliveries) {
    const at = d.times.out ?? d.at;
    if (!d.vehicle || !vehicleKey(d.vehicle) || d.status === 'pending' || at < from || at >= to) continue;
    row(d.vehicle).deliveries++;
  }
  return [...rows.values()].sort((a, b) => b.transfers + b.deliveries - (a.transfers + a.deliveries) || a.vehicle.localeCompare(b.vehicle));
}

/** What rounding bills to the shop's step added (or took off) across the period. */
export function roundOffTotal(bills: BillMirror[], step: number, from: string, to: string): number {
  let sum = 0;
  // The round-off billing put on each bill; a bill from before billing sent it, by the old step.
  for (const b of bills) if (!b.cancelled && b.at >= from && b.at < to) sum += typeof b.roundOff === 'number' ? b.roundOff : roundOff(b.total, step).diff;
  return round2(sum);
}

async function load() {
  const repo = getRepo();
  const [bills, items, stock, locs] = await Promise.all([repo.listDocs<BillMirror>('bills', { omit: ['lines.ink'] }), repo.listItems(), repo.listStock(), repo.listLocations()]);
  return { bills, items, byId: new Map(items.map((i) => [i.id, i])), stock, locs };
}

reportRoutes.get(
  '/reports',
  readers,
  handler(async (req, res) => {
    const p = period(req.query);
    const d = await load();
    const repo = getRepo();
    const [sales, move, settings, vehicles, transfers, deliveries] = await Promise.all([
      salesByItem(d.bills, d.byId, p.from, p.to),
      movers(d.bills, d.items, d.stock, p.from, p.to, p.days),
      settingsOf(repo),
      repo.listDocs<Vehicle>('vehicles'),
      repo.listDocs<Transfer>('transfers'),
      repo.listDocs<Delivery>('deliveries'),
    ]);
    res.json({
      period: p,
      sales: { ...sales, roundTo: settings.roundTo, roundOff: roundOffTotal(d.bills, settings.roundTo, p.from, p.to) },
      value: stockValue(d.items, d.stock, d.locs),
      movers: move,
      outOfRange: outOfRange(d.bills, d.byId, p.from, p.to),
      trips: tripsByVehicle(vehicles, transfers, deliveries, p.from, p.to),
    });
  }),
);

/** Bills from the start of a series on, without the handwriting. */
async function seriesBills(by: SeriesBy, keys: string[]) {
  const sorted = [...keys].sort();
  const from = keyRange(by, sorted[0]!).from;
  const to = keyRange(by, sorted[sorted.length - 1]!).to;
  return getRepo().listDocs<BillMirror>('bills', { filter: { at: { gte: from, lt: to } }, omit: ['lines.ink', 'lines.moreInk'] });
}

const startOf = (q: Record<string, unknown>) => String(q.start ?? '') || undefined;

/** ?keys=2026-11-14,2026-11-15: the chart bars picked, at most a few hundred. */
function keysOf(q: Record<string, unknown>, by: SeriesBy): string[] {
  const keys = String(q.keys ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => (by === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(k));
  if (!keys.length) throw new HttpError(400, 'Pick at least one day or month');
  if (keys.length > 400) throw new HttpError(400, 'Too many periods');
  return keys;
}

/** The details of several bars together, with names and each item's quantity in its selling unit. */
async function detailsFor(q: Record<string, unknown>) {
  const by = seriesBy(q);
  const keys = keysOf(q, by);
  const itemId = String(q.itemId ?? '') || undefined;
  const repo = getRepo();
  const [bills, items] = await Promise.all([seriesBills(by, keys), repo.listItems()]);
  const byId = new Map(items.map((i) => [i.id, i]));
  if (itemId && !byId.has(itemId)) throw new HttpError(404, 'No such item');
  const d = salesDetails(bills, by, keys, itemId, byId);
  return {
    ...d,
    by,
    itemId: itemId ?? null,
    items: d.items.map((r) => {
      const it = byId.get(r.itemId);
      const u = it ? sellUnitOf(it) : undefined;
      return { ...r, nameEn: it?.nameEn || r.itemId, nameKn: it?.nameKn ?? '', unit: u?.code ?? '', unitQty: u ? round2(r.qty / u.perBase) : r.qty, baseUnit: it?.units[0]?.code ?? '' };
    }),
  };
}

const seriesBy = (q: Record<string, unknown>): SeriesBy => (q.by === 'month' ? 'month' : 'day');

/** Stock value at cost, item by item: the rows add up to Home's "Stock value at cost". ?place= keeps one place. */
reportRoutes.get(
  '/admin/stock-value',
  readers,
  handler(async (req, res) => {
    const repo = getRepo();
    const [items, stock, locs] = await Promise.all([repo.listItems(), repo.listStock(), repo.listLocations()]);
    const place = String(req.query.place ?? '') || undefined;
    const v = stockValueRows(items, stock, place);
    res.json({ ...v, total: round2(v.total), place: place ?? null, places: locs.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name, nameKn: l.nameKn })) });
  }),
);

/** Sales over time: ?by=day (last 30 days) or month (last 12), ?itemId= for one item. Shop days in IST. */
reportRoutes.get(
  '/admin/sales-series',
  readers,
  handler(async (req, res) => {
    const by = seriesBy(req.query);
    const itemId = String(req.query.itemId ?? '') || undefined;
    const start = startOf(req.query);
    const keys = seriesKeys(by, Date.now(), start);
    const [bills, items] = await Promise.all([seriesBills(by, keys), getRepo().listItems()]);
    res.json({ by, itemId: itemId ?? null, start: keys[0], latest: seriesKeys(by)[0], points: salesSeries(bills, by, itemId, Date.now(), start, new Map(items.map((i) => [i.id, i]))) });
  }),
);

/** The chart bars picked, together: ?by=&keys=a,b&itemId=. */
reportRoutes.get(
  '/admin/sales-details',
  readers,
  handler(async (req, res) => {
    res.json(await detailsFor(req.query));
  }),
);

function sendCsv(res: import('express').Response, file: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + file + '"');
  res.send(body);
}

reportRoutes.get(
  '/reports/:kind.csv',
  readers,
  handler(async (req, res) => {
    const p = period(req.query);
    const d = await load();
    const span = String(req.query.from ?? '') + '_' + String(req.query.to ?? '');
    switch (req.params.kind) {
      case 'sales': {
        const s = await salesByItem(d.bills, d.byId, p.from, p.to);
        const rows: (string | number)[][] = s.rows.map((r) => [r.itemId, r.name, r.nameKn, r.baseQty, d.byId.get(r.itemId)?.units[0]?.code ?? '', r.lines, r.amount, r.cost, round2(r.amount - r.cost)]);
        rows.push(['', 'Not yet linked (handwriting to digitise)', '', '', '', s.unlinkedLines, s.unlinked, '', '']);
        rows.push(['', 'Not stock (services, charges)', '', '', '', '', s.notStock, '', '']);
        return sendCsv(res, 'sales-by-item-' + span + '.csv', toCsv(['item_id', 'name_en', 'name_kn', 'qty_base', 'base_unit', 'lines', 'sales', 'cost', 'margin'], rows));
      }
      case 'movers': {
        const m = await movers(d.bills, d.items, d.stock, p.from, p.to, p.days);
        const rows = [...m.fast.map((r) => ['fast', r.name, r.nameKn, r.sold, r.unit, r.perDay, r.have, r.daysLeft ?? '']), ...m.slow.map((r) => ['slow', r.name, r.nameKn, r.sold, r.unit, r.perDay, r.have, r.daysLeft ?? ''])];
        return sendCsv(res, 'movers-' + span + '.csv', toCsv(['kind', 'name_en', 'name_kn', 'sold', 'unit', 'per_day', 'in_stock', 'days_left'], rows));
      }
      case 'value': {
        const v = stockValue(d.items, d.stock, d.locs);
        return sendCsv(res, 'stock-value.csv', toCsv(['place', 'items', 'value_at_cost', 'below_zero'], v.places.map((pl) => [pl.name, pl.items, pl.value, pl.negative])));
      }
      case 'prices': {
        const o = outOfRange(d.bills, d.byId, p.from, p.to);
        return sendCsv(res, 'prices-outside-range-' + span + '.csv', toCsv(['bill', 'at', 'line', 'item', 'unit', 'qty', 'rate', 'usual', 'why'], o.map((r) => [r.billNo, r.at, r.line, r.name, r.unit, r.qty, r.rate, r.usual, r.why])));
      }
      case 'bills': {
        const { roundTo } = await settingsOf(getRepo());
        const rows: (string | number)[][] = [];
        for (const b of d.bills.filter((x) => x.at >= p.from && x.at < p.to).sort((a, c) => a.no - c.no)) {
          for (const l of b.lines) rows.push([b.no, b.at, b.customer?.name ?? '', b.cancelled ? 'cancelled' : '', l.i + 1, l.name || l.reading?.readText || (l.ink || l.inked ? '[handwritten]' : ''), l.itemId ? name(d.byId.get(l.itemId), l.itemId) : '', l.qty, l.rate, l.amount, l.state]);
          // The round-off as a line of its own, so the amounts still add up to what was collected.
          const r = typeof b.roundOff === 'number' ? { diff: b.roundOff } : roundOff(b.total, roundTo);
          if (r.diff) rows.push([b.no, b.at, b.customer?.name ?? '', b.cancelled ? 'cancelled' : '', '', 'Round off', '', '', '', r.diff, '']);
        }
        return sendCsv(res, 'bills-' + span + '.csv', toCsv(['bill', 'at', 'customer', 'cancelled', 'line', 'written_or_typed', 'item', 'qty', 'rate', 'amount', 'how_matched'], rows));
      }
      case 'trips': {
        const repo = getRepo();
        const [vehicles, transfers, deliveries] = await Promise.all([repo.listDocs<Vehicle>('vehicles'), repo.listDocs<Transfer>('transfers'), repo.listDocs<Delivery>('deliveries')]);
        const t = tripsByVehicle(vehicles, transfers, deliveries, p.from, p.to);
        return sendCsv(res, 'trips-by-vehicle-' + span + '.csv', toCsv(['vehicle', 'type', 'driver', 'transfers', 'deliveries', 'trips'], t.map((r) => [r.vehicle, r.type, r.driver, r.transfers, r.deliveries, r.transfers + r.deliveries])));
      }
      case 'stock-value-items': {
        const place = String(req.query.place ?? '') || undefined;
        const v = stockValueRows(d.items, d.stock, place);
        const rows: (string | number)[][] = v.rows.map((r) => [r.itemId, r.nameEn, r.nameKn, r.qty, r.unit, r.baseQty, r.baseUnit, r.unitCost ?? '', r.value, r.noCost ? 'no cost' : '']);
        rows.push(['', 'Total', '', '', '', '', '', '', round2(v.total), '']);
        const at = place ? d.locs.find((l) => l.id === place)?.name ?? place : 'all-places';
        return sendCsv(res, 'stock-value-items-' + at + '.csv', toCsv(['item_id', 'name_en', 'name_kn', 'qty', 'unit', 'qty_base', 'base_unit', 'cost_per_unit', 'value_at_cost', 'flag'], rows));
      }
      case 'sales-series': {
        const by = seriesBy(req.query);
        const itemId = String(req.query.itemId ?? '') || undefined;
        const it = itemId ? d.byId.get(itemId) : undefined;
        if (itemId && !it) throw new HttpError(404, 'No such item');
        const start = startOf(req.query);
        const pts = salesSeries(await seriesBills(by, seriesKeys(by, Date.now(), start)), by, itemId, Date.now(), start, d.byId);
        const label = it ? (it.nameEn || it.id).replace(/[^A-Za-z0-9]+/g, '-') : 'all';
        // Cost and profit cover only the linked item lines whose cost is set (sales_with_cost).
        const header = it ? [by, 'name_en', 'name_kn', 'sales', 'qty_base', 'base_unit', 'lines', 'sales_with_cost', 'cost', 'profit'] : [by, 'sales', 'bills', 'sales_with_cost', 'cost', 'profit'];
        const rows = pts.map((p) => (it ? [p.key, it.nameEn, it.nameKn, p.amount, p.qty, it.units[0]?.code ?? '', p.count, p.costedSales, p.cost, p.profit] : [p.key, p.amount, p.count, p.costedSales, p.cost, p.profit]));
        return sendCsv(res, 'sales-by-' + by + '-' + label + '.csv', toCsv(header, rows));
      }
      case 'sales-details': {
        const x = await detailsFor(req.query);
        const span = x.keys.length === 1 ? x.keys[0]! : x.keys[0] + '_and_' + (x.keys.length - 1) + '_more';
        const rows: (string | number)[][] = [['Periods', x.keys.join(' + ')], ['Total sales', x.amount], ['Bills', x.bills]];
        if (x.itemId) rows.push(['Quantity (base)', x.qty]);
        rows.push(['Sales linked to items', x.linkedSales], ['Sales with cost set', x.costedSales], ['Cost', x.cost], [x.profit < 0 ? 'Loss' : 'Profit', x.profit], ['Margin %', x.margin ?? '']);
        if (x.noCostItems) rows.push(['Items with no cost (left out of profit)', x.noCostItems]);
        rows.push([], ['item_id', 'name_en', 'name_kn', 'qty', 'unit', 'qty_base', 'base_unit', 'lines', 'sales', 'cost', 'profit']);
        for (const r of x.items) rows.push([r.itemId, r.nameEn, r.nameKn, r.unitQty, r.unit, r.qty, r.baseUnit, r.lines, r.amount, r.cost ?? 'no cost', r.profit ?? '']);
        rows.push([], x.itemId ? ['bill', 'at', 'qty', 'unit', 'rate', 'amount', 'cost', 'profit'] : ['bill', 'at', 'bill_total']);
        for (const r of x.rows) rows.push(x.itemId ? [r.billNo, r.at, r.qty, r.unit, r.rate, r.amount, r.cost ?? 'no cost', r.profit ?? ''] : [r.billNo, r.at, r.total]);
        return sendCsv(res, 'sales-details-' + span + '.csv', toCsv(['what', 'value'], rows));
      }
      default:
        throw new HttpError(404, 'No such report');
    }
  }),
);
