import { Router } from 'express';
import { z } from 'zod';
import {
  addTrackPoint,
  isActiveDelivery,
  normalisePhone,
  suggestVehicle,
  trimTrack,
  type BillMirror,
  type CustomerProfile,
  type Delivery,
  type Vehicle,
} from '@stock/core';
import { requireRole } from '../auth';
import { emit } from '../events';
import { geocoder } from '../geocode';
import { handler, HttpError } from '../http';
import { settingsOf } from '../setup';
import { getRepo } from '../store';
import { newId, type InvRepo, type PersonRecord } from '../store/types';

/**
 * Home deliveries, done by Workers.
 *
 * The admin starts one from a bill (or for a customer), drops the pin, takes or switches the
 * suggested vehicle and picks a worker. The worker sees only their own: starts it (their phone
 * then sends its position while the screen is open), and marks it delivered or not.
 *
 * Statuses keep the old record's words: 'pending' is Assigned, 'out' is On the way. Positions are
 * kept only while a delivery is on the way; when it ends, only the route's start and end stay.
 */
export const deliveryRoutes = Router();

const admin = requireRole('admin');
const worker = requireRole('worker', 'godown', 'admin');

/** Positions closer together in time than this are dropped: the phone sends one every ~10 s. */
export const MIN_POSITION_GAP_MS = 3000;
/** Finished deliveries stay on the admin's list this long. */
const RECENT_MS = 24 * 3600_000;

const now = () => new Date().toISOString();
const isWorker = (p: PersonRecord) => p.active && (p.role === 'worker' || p.role === 'godown');

/** Lines that are goods: a delivery charge or a note is not an item to carry. */
const itemLines = (b: BillMirror) => b.lines.filter((l) => l.state !== 'not-item').length;

function tell(d: Delivery): void {
  // The admin always; the worker only for their own (never every position).
  emit('delivery', d.personId ? { personId: d.personId } : { roles: [] }, d.id);
}

async function ownDelivery(repo: InvRepo, id: string, me: PersonRecord): Promise<Delivery> {
  const d = await repo.getDoc<Delivery>('deliveries', id);
  // Someone else's delivery is "not found", the same as one that does not exist.
  if (!d || (d.personId !== me.id && me.role !== 'admin')) throw new HttpError(404, 'No such delivery');
  return d;
}

// ---------------------------------------------------------------- admin

/** What the New delivery form starts from: a bill, or a customer, with the suggested vehicle. */
deliveryRoutes.get(
  '/admin/deliveries/draft',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const settings = await settingsOf(repo);
    let billNo = 0;
    let itemCount = 0;
    let amount = 0;
    let amountDue = 0;
    let key = String(req.query.customer ?? '');
    let name = '';
    let phone = '';
    if (req.query.bill) {
      const b = await repo.getDoc<BillMirror>('bills', String(Number(req.query.bill)));
      if (!b) throw new HttpError(404, 'No such bill');
      billNo = b.no;
      itemCount = itemLines(b);
      amount = b.total;
      amountDue = Math.max(0, b.balance);
      key = b.customer?.key ?? '';
      name = b.customer?.name ?? '';
      phone = b.customer?.phone ?? '';
    }
    const c = key ? await repo.getDoc<CustomerProfile>('customers', 'c_' + key) : null;
    res.json({
      billNo,
      customerKey: key,
      name: name || c?.name || '',
      phone: phone || (c && /^\d{10}$/.test(c.key) ? c.key : ''),
      address: c?.address ?? '',
      landmark: c?.landmark ?? '',
      ...(c?.lat != null && c?.lng != null ? { lat: c.lat, lng: c.lng } : {}),
      itemCount,
      amount,
      amountDue,
      vehicleKind: suggestVehicle({ itemCount, amount }, settings),
      rule: { bikeMaxItems: settings.bikeMaxItems, bikeMaxAmount: settings.bikeMaxAmount },
    });
  }),
);

/** The workers a delivery can go to. */
deliveryRoutes.get(
  '/admin/deliveries/workers',
  admin,
  handler(async (_req, res) => {
    const people = await getRepo().listPeople();
    res.json(people.filter(isWorker).map((p) => ({ id: p.id, name: p.name, phone: p.phone })).sort((a, b) => a.name.localeCompare(b.name)));
  }),
);

const latLng = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };
const createBody = z.object({
  billNo: z.number().int().min(0).default(0),
  customerKey: z.string().trim().max(40).default(''),
  name: z.string().trim().min(1, 'Give the customer’s name').max(80),
  phone: z.string().trim().max(20).default(''),
  address: z.string().trim().min(1, 'Give the address').max(300),
  landmark: z.string().trim().max(120).optional(),
  ...latLng,
  itemCount: z.number().int().min(0).max(10_000),
  amount: z.number().min(0).max(10_000_000).default(0),
  amountDue: z.number().min(0).max(10_000_000).default(0),
  vehicleKind: z.enum(['bike', 'car']).optional(),
  vehicle: z.string().trim().max(40).optional(),
  personId: z.string().min(1, 'Pick a worker'),
  note: z.string().trim().max(300).optional(),
});

deliveryRoutes.post(
  '/admin/deliveries',
  admin,
  handler(async (req, res) => {
    const b = createBody.parse(req.body);
    const repo = getRepo();
    const person = await repo.getPerson(b.personId);
    if (!person || !isWorker(person)) throw new HttpError(400, 'Pick a worker who signs in');
    const phone = b.phone ? normalisePhone(b.phone) : '';
    if (b.phone && phone.length !== 10) throw new HttpError(400, 'The phone should be 10 digits');
    const settings = await settingsOf(repo);
    const at = now();
    const d: Delivery = {
      id: newId('dl'),
      billNo: b.billNo,
      customerKey: b.customerKey || phone,
      name: b.name,
      phone,
      address: b.address,
      ...(b.landmark ? { landmark: b.landmark } : {}),
      lat: b.lat,
      lng: b.lng,
      itemCount: b.itemCount,
      vehicleKind: b.vehicleKind ?? suggestVehicle({ itemCount: b.itemCount, amount: b.amount }, settings),
      ...(b.vehicle ? { vehicle: b.vehicle } : {}),
      personId: person.id,
      status: 'pending',
      amountDue: b.amountDue,
      ...(b.note ? { note: b.note } : {}),
      at,
      times: { pending: at },
      by: req.person!.id,
    };
    await repo.putDoc('deliveries', d);
    // The pin is kept on the customer, for next time.
    const key = d.customerKey;
    if (key) {
      const c = await repo.getDoc<CustomerProfile>('customers', 'c_' + key);
      await repo.putDoc<CustomerProfile>('customers', {
        ...(c ?? { id: 'c_' + key, key, name: b.name, balance: 0 }),
        ...(c?.address ? {} : { address: b.address }),
        ...(b.landmark && !c?.landmark ? { landmark: b.landmark } : {}),
        lat: b.lat,
        lng: b.lng,
      });
    }
    tell(d);
    res.status(201).json(d);
  }),
);

/** Switch the vehicle or the worker, before it is over. */
deliveryRoutes.put(
  '/admin/deliveries/:id',
  admin,
  handler(async (req, res) => {
    const b = z.object({ vehicleKind: z.enum(['bike', 'car']).optional(), vehicle: z.string().trim().max(40).optional(), personId: z.string().optional() }).parse(req.body);
    const repo = getRepo();
    const d = await repo.getDoc<Delivery>('deliveries', String(req.params.id));
    if (!d) throw new HttpError(404, 'No such delivery');
    if (!isActiveDelivery(d.status)) throw new HttpError(409, 'This delivery is already over');
    const was = d.personId;
    if (b.personId && b.personId !== d.personId) {
      if (d.status !== 'pending') throw new HttpError(409, 'It is on the way: the worker cannot change now');
      const p = await repo.getPerson(b.personId);
      if (!p || !isWorker(p)) throw new HttpError(400, 'Pick a worker who signs in');
      d.personId = p.id;
    }
    if (b.vehicleKind) d.vehicleKind = b.vehicleKind;
    if (b.vehicle != null) d.vehicle = b.vehicle || undefined;
    await repo.putDoc('deliveries', d);
    tell(d);
    if (was && was !== d.personId) emit('delivery', { personId: was }, d.id);
    res.json(d);
  }),
);

/** The live list: everything still out, and what finished in the last day, with the worker's name. */
deliveryRoutes.get(
  '/admin/deliveries',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const since = new Date(Date.now() - RECENT_MS).toISOString();
    const [active, recent, people, settings] = await Promise.all([
      repo.listDocs<Delivery>('deliveries', { status: ['pending', 'out'] }),
      repo.listDocs<Delivery>('deliveries', { filter: { status: ['delivered', 'failed'], at: { gte: since } }, sort: { at: -1 }, limit: 50 }),
      repo.listPeople(),
      settingsOf(repo),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const list = [...active.sort((a, b) => b.at.localeCompare(a.at)), ...recent].map((d) => ({ ...d, personName: d.personId ? (nameOf.get(d.personId) ?? '') : '' }));
    res.json({
      shop: settings.shopLat != null && settings.shopLng != null ? { lat: settings.shopLat, lng: settings.shopLng } : null,
      deliveries: list,
    });
  }),
);

/** The address search for the pin, through the server: see geocode.ts. */
deliveryRoutes.get(
  '/admin/geocode',
  admin,
  handler(async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 200);
    try {
      res.json(await geocoder().search(q));
    } catch {
      throw new HttpError(502, 'The address search is not answering. Drop the pin on the map by hand.');
    }
  }),
);

// ---------------------------------------------------------------- the worker

/** The worker's own deliveries: still to do, and today's finished ones. Never anyone else's. */
deliveryRoutes.get(
  '/worker/deliveries',
  worker,
  handler(async (req, res) => {
    const repo = getRepo();
    const since = new Date(Date.now() - RECENT_MS).toISOString();
    const mine = await repo.listDocs<Delivery>('deliveries', { personId: req.person!.id });
    const shown = mine
      .filter((d) => isActiveDelivery(d.status) || d.at >= since)
      .sort((a, b) => Number(isActiveDelivery(b.status)) - Number(isActiveDelivery(a.status)) || b.at.localeCompare(a.at))
      // The worker needs the job, not the route the server keeps.
      .map(({ track: _t, by: _b, ...d }) => d);
    res.json(shown);
  }),
);

deliveryRoutes.post(
  '/worker/deliveries/:id/start',
  worker,
  handler(async (req, res) => {
    const repo = getRepo();
    const d = await ownDelivery(repo, String(req.params.id), req.person!);
    if (d.status === 'out') return res.json(d);
    if (d.status !== 'pending') throw new HttpError(409, 'This delivery is already over');
    d.status = 'out';
    d.times.out = now();
    d.track = [];
    await repo.putDoc('deliveries', d);
    tell(d);
    res.json(d);
  }),
);

deliveryRoutes.post(
  '/worker/deliveries/:id/position',
  worker,
  handler(async (req, res) => {
    const b = z.object({ ...latLng }).parse(req.body);
    const repo = getRepo();
    const d = await ownDelivery(repo, String(req.params.id), req.person!);
    // Only while on the way: nothing is kept before Start or after it is over.
    if (d.status !== 'out') throw new HttpError(409, 'Start the delivery first');
    const at = now();
    if (d.pos && Date.parse(at) - Date.parse(d.pos.at) < MIN_POSITION_GAP_MS) return res.json({ kept: false });
    const p = { lat: b.lat, lng: b.lng, at };
    d.pos = p;
    d.track = addTrackPoint(d.track, p);
    await repo.putDoc('deliveries', d);
    // Positions go to the admin's map only.
    emit('delivery', { roles: [] }, d.id);
    res.json({ kept: true });
  }),
);

async function finish(req: import('express').Request, status: 'delivered' | 'failed', patch: Partial<Delivery>): Promise<Delivery> {
  const repo = getRepo();
  const d = await ownDelivery(repo, String(req.params.id), req.person!);
  if (!isActiveDelivery(d.status)) throw new HttpError(409, 'This delivery is already over');
  Object.assign(d, patch);
  d.status = status;
  d.times[status] = now();
  // The route is not kept: only where it started and ended.
  d.track = trimTrack(d.track);
  delete d.pos;
  await repo.putDoc('deliveries', d);
  tell(d);
  return d;
}

deliveryRoutes.post(
  '/worker/deliveries/:id/delivered',
  worker,
  handler(async (req, res) => {
    const b = z.object({ collected: z.number().min(0).max(10_000_000).default(0) }).parse(req.body);
    res.json(await finish(req, 'delivered', { collected: b.collected }));
  }),
);

deliveryRoutes.post(
  '/worker/deliveries/:id/failed',
  worker,
  handler(async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(1, 'Say why it could not be delivered').max(200) }).parse(req.body);
    res.json(await finish(req, 'failed', { reason: b.reason }));
  }),
);

/** The vehicles of one kind, for the form's vehicle box. */
export const vehiclesOfKind = (all: Vehicle[], kind: 'bike' | 'car') => all.filter((v) => v.active && v.kind === kind);
