import { Router } from 'express';
import { z } from 'zod';
import { expiringWithin, findUnit, landedUnitCost, poStage, priceVolatility, receivedQty, round2, soonestExpiry, unitCostsFrom, type BillMirror, type Carrier, type CarrierLoad, type CarrierTrip, type LoadLine, type Lot, type PurchaseOrder, type Supplier } from '@stock/core';
import { audit, requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';
import { newId } from '../store/types';
import { emit } from '../events';

/**
 * Purchasing (agent B): goods carriers and their trips, expiry lots, and the facts the product
 * list sorts by. The receive itself, with the landed cost, stays with the orders in actions.ts.
 */
export const purchasingRoutes = Router();

const admin = requireRole('admin');
const now = () => new Date().toISOString();
/** Today in India, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- carriers

const carrierBody = z.object({
  name: z.string().trim().min(1, 'Give the owner or driver a name').max(80),
  phone: z.string().trim().max(20).optional(),
  vehicleNo: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(300).optional(),
  active: z.boolean().optional(),
});

function carrierFrom(b: z.infer<typeof carrierBody>, id: string, old?: Carrier): Carrier {
  return {
    id,
    name: b.name,
    ...(b.phone ? { phone: b.phone } : {}),
    ...(b.vehicleNo ? { vehicleNo: b.vehicleNo.toUpperCase() } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
    active: b.active ?? old?.active ?? true,
  };
}

/** Every carrier, with their trips newest first (the last 200 trips in all), and the deliveries each brought (from the orders' checklists, newest first). */
purchasingRoutes.get(
  '/admin/carriers',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [carriers, trips, pos] = await Promise.all([
      repo.listDocs<Carrier>('carriers'),
      repo.listDocs<CarrierTrip>('trips', { sort: { date: -1, at: -1 }, limit: 200 }),
      repo.listDocs<PurchaseOrder>('pos', { filter: { 'checklists.carrierId': { exists: true } }, fields: ['no', 'supplierId', 'checklists'] }),
    ]);
    carriers.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    const deliveries = pos
      .flatMap((p) => (p.checklists ?? []).filter((c) => c.carrierId).map((c) => ({ ...c, poId: p.id, poNo: p.no, supplierId: p.supplierId })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 300);
    res.json({ carriers, trips, deliveries });
  }),
);

purchasingRoutes.post(
  '/admin/carriers',
  admin,
  handler(async (req, res) => {
    const c = carrierFrom(carrierBody.parse(req.body), newId('car'));
    await getRepo().putDoc('carriers', c);
    emit('pos');
    res.status(201).json(c);
  }),
);

purchasingRoutes.put(
  '/admin/carriers/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const old = await repo.getDoc<Carrier>('carriers', String(req.params.id));
    if (!old) throw new HttpError(404, 'No such carrier');
    const c = carrierFrom(carrierBody.parse(req.body), old.id, old);
    await repo.putDoc('carriers', c);
    emit('pos');
    res.json(c);
  }),
);

// ---------------------------------------------------------------- trips

const tripBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the trip a date'),
  carrierId: z.string(),
  supplierId: z.string().optional(),
  lines: z.array(z.object({ itemId: z.string(), unit: z.string(), qty: z.number().positive().max(1e6), value: z.number().min(0).max(1e8).optional() })).max(100).default([]),
  charge: z.number().min(0).max(1e7),
});

async function checkTrip(b: z.infer<typeof tripBody>): Promise<void> {
  const repo = getRepo();
  const [car, sup, items] = await Promise.all([
    repo.getDoc<Carrier>('carriers', b.carrierId),
    b.supplierId ? repo.getDoc<Supplier>('suppliers', b.supplierId) : Promise.resolve(null),
    repo.listItems(),
  ]);
  if (!car) throw new HttpError(404, 'No such carrier');
  if (b.supplierId && !sup) throw new HttpError(404, 'No such supplier');
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of b.lines) {
    const it = byId.get(l.itemId);
    if (!it) throw new HttpError(400, 'An item on this trip does not exist');
    if (!findUnit(it, l.unit)) throw new HttpError(400, it.nameEn + ' has no unit "' + l.unit + '"');
  }
}

purchasingRoutes.post(
  '/admin/trips',
  admin,
  handler(async (req, res) => {
    const b = tripBody.parse(req.body);
    await checkTrip(b);
    const t: CarrierTrip = { id: newId('trip'), date: b.date, carrierId: b.carrierId, ...(b.supplierId ? { supplierId: b.supplierId } : {}), lines: b.lines, charge: b.charge, at: now() };
    await getRepo().putDoc('trips', t);
    emit('pos');
    res.status(201).json(t);
  }),
);

purchasingRoutes.put(
  '/admin/trips/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const old = await repo.getDoc<CarrierTrip>('trips', String(req.params.id));
    if (!old) throw new HttpError(404, 'No such trip');
    const b = tripBody.parse(req.body);
    await checkTrip(b);
    // A trip already in a receipt keeps its charge: that charge is in the items' cost now.
    if (old.poId && b.charge !== old.charge) throw new HttpError(409, 'This trip is in a receipt already: its charge cannot change');
    const t: CarrierTrip = { id: old.id, date: b.date, carrierId: b.carrierId, ...(b.supplierId ? { supplierId: b.supplierId } : {}), lines: b.lines, charge: b.charge, ...(old.poId ? { poId: old.poId } : {}), at: old.at };
    await repo.putDoc('trips', t);
    emit('pos');
    res.json(t);
  }),
);

purchasingRoutes.delete(
  '/admin/trips/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const old = await repo.getDoc<CarrierTrip>('trips', String(req.params.id));
    if (!old) throw new HttpError(404, 'No such trip');
    if (old.poId) throw new HttpError(409, 'This trip is in a receipt already');
    await repo.deleteDoc('trips', old.id);
    emit('pos');
    res.json({ ok: true });
  }),
);

/** Trips not yet in a receipt, to link one when receiving an order. */
purchasingRoutes.get(
  '/admin/trips/open',
  admin,
  handler(async (_req, res) => {
    const trips = await getRepo().listDocs<CarrierTrip>('trips', { filter: { poId: { exists: false } }, sort: { date: -1 }, limit: 50 });
    res.json(trips);
  }),
);

// ---------------------------------------------------------------- lots and expiry

/** One item's lots with stock left, soonest expiry first. In transit ones are shown as such. */
purchasingRoutes.get(
  '/admin/items/:id/lots',
  admin,
  handler(async (req, res) => {
    const lots = await getRepo().listDocs<Lot>('lots', { filter: { itemId: String(req.params.id) }, sort: { expiry: 1 } });
    res.json(lots.filter((l) => l.qty > 0));
  }),
);

// ---------------------------------------------------------------- expiry for stock already on hand

const lotBody = z.object({
  itemId: z.string().min(1),
  placeId: z.string().min(1),
  qty: z.number().positive('The quantity must be more than 0'),
  /** The unit the qty is in; the item's base unit when left out. */
  unit: z.string().optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the expiry as a date'),
});

/** What of an item at a place has no expiry yet: on hand there, less its lots (one left out). */
async function untracked(itemId: string, placeId: string, skipLot?: string): Promise<number> {
  const repo = getRepo();
  const [levels, lots] = await Promise.all([repo.listStock([itemId]), repo.listDocs<Lot>('lots', { itemId, placeId })]);
  const onHand = levels.find((s) => s.locationId === placeId)?.qty ?? 0;
  const inLots = lots.filter((l) => l.id !== skipLot && l.qty > 0).reduce((n, l) => n + l.qty, 0);
  return Math.max(0, onHand - inLots);
}

async function lotFrom(b: z.infer<typeof lotBody>, skipLot?: string) {
  const repo = getRepo();
  const item = (await repo.listItems()).find((i) => i.id === b.itemId);
  if (!item) throw new HttpError(404, 'No such item');
  const loc = (await repo.listLocations()).find((l) => l.id === b.placeId);
  if (!loc) throw new HttpError(404, 'No such place');
  const unit = b.unit ? findUnit(item, b.unit) : item.units[0];
  if (!unit) throw new HttpError(400, 'The item has no unit ' + b.unit);
  const qty = Math.round(b.qty * unit.perBase * 1e6) / 1e6;
  const free = await untracked(item.id, loc.id, skipLot);
  if (qty > free + 1e-9) throw new HttpError(400, 'Only ' + free + ' ' + item.units[0]!.code + ' at this place has no expiry date yet');
  return { qty, placeId: loc.id, itemId: item.id, expiry: b.expiry };
}

/** Puts an expiry date on stock already on the shelf: a lot with ref "manual". */
purchasingRoutes.post(
  '/admin/lots',
  admin,
  handler(async (req, res) => {
    const b = lotBody.parse(req.body);
    const lot: Lot = { id: newId('lot'), ...(await lotFrom(b)), receivedAt: now(), ref: 'manual' };
    await getRepo().putDocs<Lot>('lots', [lot]);
    emit('pos');
    res.status(201).json(lot);
  }),
);

/** Changes a lot's date, quantity or place; the same on-hand limit applies. */
purchasingRoutes.put(
  '/admin/lots/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const old = await repo.getDoc<Lot>('lots', String(req.params.id));
    if (!old) throw new HttpError(404, 'No such expiry lot');
    const b = lotBody.partial({ itemId: true }).parse(req.body);
    const lot: Lot = { ...old, ...(await lotFrom({ ...b, itemId: old.itemId }, old.id)) };
    await repo.putDoc('lots', lot);
    emit('pos');
    res.json(lot);
  }),
);

purchasingRoutes.delete(
  '/admin/lots/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    if (!(await repo.getDoc<Lot>('lots', String(req.params.id)))) throw new HttpError(404, 'No such expiry lot');
    await repo.deleteDoc('lots', String(req.params.id));
    emit('pos');
    res.json({ ok: true });
  }),
);

/** Lots expiring within `days` (15 by default), expired ones included, with the item's names. */
purchasingRoutes.get(
  '/admin/expiring',
  admin,
  handler(async (req, res) => {
    const days = Math.min(365, Math.max(0, Number(req.query.days ?? 15) || 15));
    const repo = getRepo();
    const until = new Date(Date.parse(today() + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10);
    const [lots, items] = await Promise.all([repo.listDocs<Lot>('lots', { filter: { expiry: { lte: until } }, sort: { expiry: 1 } }), repo.listItems()]);
    const names = new Map(items.map((i) => [i.id, i]));
    res.json(
      expiringWithin(lots, today(), days).map((l) => {
        const it = names.get(l.itemId);
        return { ...l, nameEn: it?.nameEn ?? l.itemId, nameKn: it?.nameKn ?? '' };
      }),
    );
  }),
);

/** What the product list sorts by: each item's last-30-days sold quantity, its soonest expiry, and how often its price changed in 90 days (from the mirrored bills). */
purchasingRoutes.get(
  '/admin/list-facts',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const from = new Date(Date.now() - 30 * 86400_000).toISOString();
    const from90 = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [moves, lots, bills] = await Promise.all([repo.listMoves({ from }), repo.listDocs<Lot>('lots', { filter: { qty: { gt: 0 } }, fields: ['itemId', 'qty', 'expiry', 'placeId'] }), repo.listDocs<BillMirror>('bills', { filter: { at: { gte: from90 } }, omit: ['lines.ink', 'lines.reading', 'customer'] })]);
    const sold: Record<string, number> = {};
    for (const m of moves) if (m.kind === 'sale') sold[m.itemId] = Math.round(((sold[m.itemId] ?? 0) + m.qty) * 1000) / 1000;
    res.json({ sold, expiry: Object.fromEntries(soonestExpiry(lots.filter((l) => !String(l.placeId).startsWith('transit:')))), volatility: Object.fromEntries(priceVolatility(bills)) });
  }),
);

// ---------------------------------------------------------------- carrier loads

/*
 * Lines of open orders (from any vendors) put on a carrier's load, each with its own delivery
 * rate per unit. A line is on one load at most while it waits; moving it takes it off the other.
 * The checklist (actions.ts) posts what came and marks it received on the load.
 */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the date as a date');
const lineRef = z.object({ poId: z.string().min(1), itemId: z.string().min(1), ratePerUnit: z.number().min(0).max(1e6).optional() });
const lineKey = (poId: string, itemId: string) => poId + '|' + itemId;

async function needCarrier(id: string): Promise<Carrier> {
  const car = await getRepo().getDoc<Carrier>('carriers', id);
  if (!car) throw new HttpError(404, 'No such carrier');
  return car;
}

async function loadById(id: string): Promise<CarrierLoad> {
  const ld = await getRepo().getDoc<CarrierLoad>('loads', id);
  if (!ld) throw new HttpError(404, 'No such carrier load');
  return ld;
}

/** Carrier loads, newest first (the last 200). */
purchasingRoutes.get(
  '/admin/loads',
  admin,
  handler(async (_req, res) => {
    res.json(await getRepo().listDocs<CarrierLoad>('loads', { sort: { date: -1, at: -1 }, limit: 200 }));
  }),
);

purchasingRoutes.get(
  '/admin/loads/:id',
  admin,
  handler(async (req, res) => {
    res.json(await loadById(String(req.params.id)));
  }),
);

/**
 * Puts open order lines on a carrier's load: an existing one (`loadId`), or a new one for
 * `carrierId` (vehicle, driver and date optional). Lines already on another load move off it,
 * keeping their rate unless a new one is given. Each line's qty is what is still due on the order.
 */
purchasingRoutes.post(
  '/admin/loads/move',
  admin,
  handler(async (req, res) => {
    const b = z
      .object({
        lines: z.array(lineRef).min(1).max(200),
        loadId: z.string().min(1).optional(),
        carrierId: z.string().min(1).optional(),
        vehicleNo: z.string().trim().max(20).optional(),
        driverName: z.string().trim().max(80).optional(),
        date: ymd.optional(),
      })
      .parse(req.body);
    if (!b.loadId && !b.carrierId) throw new HttpError(400, 'Choose the carrier');
    if (new Set(b.lines.map((l) => lineKey(l.poId, l.itemId))).size !== b.lines.length) throw new HttpError(400, 'A line is chosen twice');
    const repo = getRepo();
    const by = audit(req).by;
    const at = now();
    let target: CarrierLoad;
    if (b.loadId) {
      target = await loadById(b.loadId);
    } else {
      const car = await needCarrier(b.carrierId!);
      const vehicleNo = (b.vehicleNo || car.vehicleNo)?.toUpperCase();
      target = {
        id: newId('load'),
        carrierId: car.id,
        ...(vehicleNo ? { vehicleNo } : {}),
        ...(b.driverName ? { driverName: b.driverName } : {}),
        date: b.date ?? today(),
        lines: [],
        history: [{ at, by, action: 'create', carrierId: car.id }],
        at,
      };
    }
    // The orders, each line still due.
    const poIds = [...new Set(b.lines.map((l) => l.poId))];
    const pos = new Map<string, PurchaseOrder>();
    for (const id of poIds) {
      const p = await repo.getDoc<PurchaseOrder>('pos', id);
      if (!p) throw new HttpError(404, 'No such order');
      if (poStage(p.status) !== 'ordered') throw new HttpError(409, 'Order ' + p.no + ' is already ' + p.status);
      pos.set(id, p);
    }
    // Other loads holding any of these lines, waiting.
    const others = (await repo.listDocs<CarrierLoad>('loads', { filter: { 'lines.poId': poIds } })).filter((x) => x.id !== target.id);
    const fresh: LoadLine[] = [];
    const movedFrom = new Map<string, { ld: CarrierLoad; lines: { poId: string; itemId: string; qty: number }[] }>();
    for (const l of b.lines) {
      const p = pos.get(l.poId)!;
      const pl = p.lines.find((x) => x.itemId === l.itemId);
      if (!pl) throw new HttpError(400, 'An item is not on order ' + p.no);
      const due = Math.max(0, Math.round((pl.qty - receivedQty(p, l.itemId)) * 1e6) / 1e6);
      if (!(due > 0)) throw new HttpError(400, 'Nothing is still due of that item on order ' + p.no);
      let rate = l.ratePerUnit;
      let moved = false;
      for (const o of others) {
        const i = o.lines.findIndex((x) => x.poId === l.poId && x.itemId === l.itemId && !x.received);
        if (i < 0) continue;
        rate ??= o.lines[i]!.ratePerUnit;
        o.lines.splice(i, 1);
        const m = movedFrom.get(o.id) ?? { ld: o, lines: [] };
        m.lines.push({ poId: l.poId, itemId: l.itemId, qty: due });
        movedFrom.set(o.id, m);
        moved = true;
      }
      const cur = target.lines.find((x) => x.poId === l.poId && x.itemId === l.itemId && !x.received);
      if (cur) {
        cur.qty = due;
        if (l.ratePerUnit != null) cur.ratePerUnit = l.ratePerUnit;
        continue;
      }
      const line: LoadLine = { poId: l.poId, itemId: l.itemId, qty: due, ratePerUnit: rate ?? 0 };
      target.lines.push(line);
      if (!moved) fresh.push(line);
    }
    for (const { ld, lines } of movedFrom.values()) {
      ld.history.push({ at, by, action: 'move-out', loadId: target.id, carrierId: target.carrierId, lines });
      target.history.push({ at, by, action: 'move-in', loadId: ld.id, fromCarrierId: ld.carrierId, lines });
    }
    if (fresh.length) target.history.push({ at, by, action: 'add', lines: fresh.map((x) => ({ poId: x.poId, itemId: x.itemId, qty: x.qty })) });
    await repo.putDocs('loads', [...[...movedFrom.values()].map((m) => m.ld), target]);
    emit('pos');
    res.status(b.loadId ? 200 : 201).json(target);
  }),
);

/** Edits a load's vehicle, driver or date. */
purchasingRoutes.put(
  '/admin/loads/:id',
  admin,
  handler(async (req, res) => {
    const b = z.object({ vehicleNo: z.string().trim().max(20).optional(), driverName: z.string().trim().max(80).optional(), date: ymd.optional() }).parse(req.body);
    const ld = await loadById(String(req.params.id));
    if (b.vehicleNo != null) {
      if (b.vehicleNo) ld.vehicleNo = b.vehicleNo.toUpperCase();
      else delete ld.vehicleNo;
    }
    if (b.driverName != null) {
      if (b.driverName) ld.driverName = b.driverName;
      else delete ld.driverName;
    }
    if (b.date) ld.date = b.date;
    ld.history.push({ at: now(), by: audit(req).by, action: 'edit' });
    await getRepo().putDoc('loads', ld);
    emit('pos');
    res.json(ld);
  }),
);

/**
 * The carrier backed out: the load goes to another carrier. Lines already received stay with the
 * carrier who brought them, so then only the waiting lines move, to a new load.
 */
purchasingRoutes.post(
  '/admin/loads/:id/carrier',
  admin,
  handler(async (req, res) => {
    const b = z.object({ carrierId: z.string().min(1), vehicleNo: z.string().trim().max(20).optional(), driverName: z.string().trim().max(80).optional(), date: ymd.optional() }).parse(req.body);
    const repo = getRepo();
    const ld = await loadById(String(req.params.id));
    const car = await needCarrier(b.carrierId);
    if (car.id === ld.carrierId) throw new HttpError(400, 'It is already with this carrier');
    const by = audit(req).by;
    const at = now();
    const waiting = ld.lines.filter((x) => !x.received);
    if (!waiting.length) throw new HttpError(409, 'Everything on this load was received already');
    const vehicleNo = (b.vehicleNo || car.vehicleNo)?.toUpperCase();
    if (waiting.length === ld.lines.length) {
      const from = ld.carrierId;
      ld.carrierId = car.id;
      if (vehicleNo) ld.vehicleNo = vehicleNo;
      else delete ld.vehicleNo;
      if (b.driverName) ld.driverName = b.driverName;
      else delete ld.driverName;
      if (b.date) ld.date = b.date;
      ld.history.push({ at, by, action: 'carrier', carrierId: car.id, fromCarrierId: from });
      await repo.putDoc('loads', ld);
      emit('pos');
      res.json(ld);
      return;
    }
    const lines = waiting.map((x) => ({ poId: x.poId, itemId: x.itemId, qty: x.qty }));
    const nl: CarrierLoad = {
      id: newId('load'),
      carrierId: car.id,
      ...(vehicleNo ? { vehicleNo } : {}),
      ...(b.driverName ? { driverName: b.driverName } : {}),
      date: b.date ?? ld.date,
      lines: waiting,
      history: [{ at, by, action: 'move-in', loadId: ld.id, fromCarrierId: ld.carrierId, lines }],
      at,
    };
    ld.lines = ld.lines.filter((x) => x.received);
    ld.history.push({ at, by, action: 'move-out', loadId: nl.id, carrierId: car.id, lines });
    await repo.putDocs('loads', [ld, nl]);
    emit('pos');
    res.json(nl);
  }),
);

/** "Leave for next time": takes waiting lines off a load, back to "not yet assigned". */
purchasingRoutes.post(
  '/admin/loads/:id/unassign',
  admin,
  handler(async (req, res) => {
    const b = z.object({ lines: z.array(lineRef).min(1).max(200) }).parse(req.body);
    const ld = await loadById(String(req.params.id));
    const want = new Set(b.lines.map((l) => lineKey(l.poId, l.itemId)));
    const gone = ld.lines.filter((x) => !x.received && want.has(lineKey(x.poId, x.itemId)));
    if (!gone.length) throw new HttpError(400, 'None of those lines are waiting on this load');
    ld.lines = ld.lines.filter((x) => !gone.includes(x));
    ld.history.push({ at: now(), by: audit(req).by, action: 'unassign', lines: gone.map((x) => ({ poId: x.poId, itemId: x.itemId, qty: x.qty })) });
    await getRepo().putDoc('loads', ld);
    emit('pos');
    res.json(ld);
  }),
);

/**
 * Sets delivery rates per unit. On a line already received, the receipt's delivery share and
 * landed cost are worked out again, and the item's cost follows when this receipt set it and is
 * still its latest. Every change is in the load's history.
 */
purchasingRoutes.put(
  '/admin/loads/:id/rates',
  admin,
  handler(async (req, res) => {
    const b = z.object({ lines: z.array(z.object({ poId: z.string().min(1), itemId: z.string().min(1), ratePerUnit: z.number().min(0).max(1e6) })).min(1).max(200) }).parse(req.body);
    const repo = getRepo();
    const ld = await loadById(String(req.params.id));
    const changes: { poId: string; itemId: string; from: number; to: number }[] = [];
    const pos = new Map<string, PurchaseOrder>();
    let itemsChanged = false;
    for (const r of b.lines) {
      const line = ld.lines.find((x) => x.poId === r.poId && x.itemId === r.itemId);
      if (!line) throw new HttpError(400, 'That line is not on this load');
      const from = line.ratePerUnit;
      if (Math.abs(from - r.ratePerUnit) < 1e-9) continue;
      line.ratePerUnit = r.ratePerUnit;
      changes.push({ poId: r.poId, itemId: r.itemId, from, to: r.ratePerUnit });
      if (!line.received) continue;
      // The receipt's line, worked out again.
      const p = pos.get(r.poId) ?? (await repo.getDoc<PurchaseOrder>('pos', r.poId));
      if (!p) continue;
      pos.set(p.id, p);
      const rc = (p.received ?? []).find((x) => x.itemId === r.itemId && x.loadId === ld.id && (x.receipt ?? 1) === line.received!.receipt);
      if (!rc) continue;
      const oldLanded = rc.landed ?? rc.cost;
      const delivery = round2(Math.max(0, (rc.delivery ?? 0) - from * rc.qty + r.ratePerUnit * rc.qty));
      const landed = landedUnitCost(rc.cost, rc.qty, delivery);
      rc.ratePerUnit = r.ratePerUnit;
      if (delivery > 0) {
        rc.delivery = delivery;
        rc.landed = landed;
      } else {
        delete rc.delivery;
        delete rc.landed;
      }
      // The item's cost follows when this receipt set it and is still the item's latest.
      const unit = p.lines.find((x) => x.itemId === r.itemId)?.unit;
      const item = unit ? await repo.getItem(r.itemId) : null;
      const u = item && unit ? findUnit(item, unit) : undefined;
      if (!item || !unit || !u || u.cost == null || Math.abs(u.cost - round2(oldLanded)) > 0.005) continue;
      const all = await repo.listDocs<PurchaseOrder>('pos', { filter: { 'received.itemId': r.itemId }, fields: ['received'] });
      const latest = all.flatMap((q) => (q.received ?? []).filter((x) => x.itemId === r.itemId && x.qty > 0 && x.at)).reduce((m, x) => (x.at! > m ? x.at! : m), '');
      if (!rc.at || rc.at < latest) continue;
      item.units = unitCostsFrom(item.units, unit, landed);
      item.updatedAt = now();
      await repo.saveItem(item);
      itemsChanged = true;
    }
    if (changes.length) {
      ld.history.push({ at: now(), by: audit(req).by, action: 'rate', lines: changes });
      for (const p of pos.values()) await repo.putDoc('pos', p);
      await repo.putDoc('loads', ld);
      emit('pos');
      if (itemsChanged) emit('items');
    }
    res.json(ld);
  }),
);

/** Deletes a load with nothing received on it: its lines go back to "not yet assigned". */
purchasingRoutes.delete(
  '/admin/loads/:id',
  admin,
  handler(async (req, res) => {
    const ld = await loadById(String(req.params.id));
    if (ld.lines.some((x) => x.received)) throw new HttpError(409, 'Goods on this load were received: it stays as a record');
    await getRepo().deleteDoc('loads', ld.id);
    emit('pos');
    res.json({ ok: true });
  }),
);
