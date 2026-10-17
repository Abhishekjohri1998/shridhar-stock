import { Router } from 'express';
import { z } from 'zod';
import { expiringWithin, findUnit, soonestExpiry, type Carrier, type CarrierTrip, type Lot, type Supplier } from '@stock/core';
import { requireRole } from '../auth';
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

/** Every carrier, with their trips newest first (the last 200 trips in all). */
purchasingRoutes.get(
  '/admin/carriers',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [carriers, trips] = await Promise.all([repo.listDocs<Carrier>('carriers'), repo.listDocs<CarrierTrip>('trips', { sort: { date: -1, at: -1 }, limit: 200 })]);
    carriers.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    res.json({ carriers, trips });
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

/** What the product list sorts by: each item's last-30-days sold quantity and its soonest expiry. */
purchasingRoutes.get(
  '/admin/list-facts',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const from = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [moves, lots] = await Promise.all([repo.listMoves({ from }), repo.listDocs<Lot>('lots', { filter: { qty: { gt: 0 } }, fields: ['itemId', 'qty', 'expiry', 'placeId'] })]);
    const sold: Record<string, number> = {};
    for (const m of moves) if (m.kind === 'sale') sold[m.itemId] = Math.round(((sold[m.itemId] ?? 0) + m.qty) * 1000) / 1000;
    res.json({ sold, expiry: Object.fromEntries(soonestExpiry(lots.filter((l) => !String(l.placeId).startsWith('transit:')))) });
  }),
);
