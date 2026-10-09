import { Router } from 'express';
import { z } from 'zod';
import {
  addTrackPoint,
  distanceKm,
  isActiveDelivery,
  isNearby,
  makeOtp,
  OTP_MAX_TRIES,
  PAID_BY,
  normalisePhone,
  suggestVehicle,
  trimTrack,
  type BillMirror,
  type CustomerProfile,
  type Delivery,
  type Vehicle,
} from '@stock/core';
import { requireRole } from '../auth';
import { emit, type EventExtra } from '../events';
import { linkPaths } from '../links';
import { geocoder } from '../geocode';
import { handler, HttpError } from '../http';
import { roadRouter } from '../route';
import { settingsOf, shopOf } from '../setup';
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
/** A phone fix less sure than this (metres) stays off the trail. */
export const MAX_ACCURACY_M = 100;
/** Finished deliveries stay on the admin's list this long. */
const RECENT_MS = 24 * 3600_000;

const now = () => new Date().toISOString();
const isWorker = (p: PersonRecord) => p.active && (p.role === 'worker' || p.role === 'godown');

/** Lines that are goods: a delivery charge or a note is not an item to carry. */
const itemLines = (b: BillMirror) => b.lines.filter((l) => l.state !== 'not-item').length;

function tell(d: Delivery, what?: EventExtra['what']): void {
  // The admin always; the worker only for their own (never every position).
  emit('delivery', d.personId ? { personId: d.personId } : { roles: [] }, d.id, what ? { what } : {});
}

/** Ask for the road (and so the arrival time) again after this long, or once moved this far. */
export const ETA_EVERY_MS = 30_000;
export const ETA_MOVED_KM = 0.2;
/** With no road router answering: straight line, a little longer for the roads, at town speed. */
const fallbackMinutes = (km: number, kind: Delivery['vehicleKind']) => Math.max(1, Math.round(((km * 1.4) / (kind === 'car' ? 18 : 22)) * 60));

/** The arrival time from a position: the road router's minutes, or a straight-line guess. */
export async function etaFrom(d: Delivery, from: { lat: number; lng: number }): Promise<number | null> {
  if (d.lat == null || d.lng == null) return null;
  const r = await roadRouter().route(from, { lat: d.lat, lng: d.lng });
  return r ? Math.max(1, Math.round(r.minutes)) : fallbackMinutes(distanceKm(from, { lat: d.lat, lng: d.lng }), d.vehicleKind);
}

/** A photo as the phone sends it: a JPEG data URL, at most about 300 KB. */
export const MAX_PHOTO_CHARS = 400_000;

/** What the worker may see of a delivery: never the door code (the customer tells it). */
function forWorker(d: Delivery): Omit<Delivery, 'otp' | 'otpTries'> {
  const { otp: _o, otpTries: _n, ...shown } = d;
  return shown;
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
  // No pin yet is allowed: the customer can send their own location through their link.
  lat: latLng.lat.optional(),
  lng: latLng.lng.optional(),
  itemCount: z.number().int().min(0).max(10_000),
  amount: z.number().min(0).max(10_000_000).default(0),
  amountDue: z.number().min(0).max(10_000_000).default(0),
  vehicleKind: z.enum(['bike', 'car']).optional(),
  vehicle: z.string().trim().max(40).optional(),
  personId: z.string().min(1, 'Pick a worker'),
  note: z.string().trim().max(300).optional(),
  /** The customer has no phone to get the code on: delivered without it. */
  otpSkipped: z.boolean().optional(),
});

deliveryRoutes.post(
  '/admin/deliveries',
  admin,
  handler(async (req, res) => {
    const b = createBody.parse(req.body);
    if ((b.lat == null) !== (b.lng == null)) throw new HttpError(400, 'Give both parts of the pin');
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
      ...(b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : {}),
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
      otp: makeOtp(),
      ...(b.otpSkipped ? { otpSkipped: true } : {}),
    };
    await repo.putDoc('deliveries', d);
    // The pin is kept on the customer, for next time.
    const key = d.customerKey;
    if (key && b.lat != null && b.lng != null) {
      const c = await repo.getDoc<CustomerProfile>('customers', 'c_' + key);
      await repo.putDoc<CustomerProfile>('customers', {
        ...(c ?? { id: 'c_' + key, key, name: b.name, balance: 0 }),
        ...(c?.address ? {} : { address: b.address }),
        ...(b.landmark && !c?.landmark ? { landmark: b.landmark } : {}),
        lat: b.lat,
        lng: b.lng,
      });
    }
    tell(d, 'assigned');
    res.status(201).json({ ...d, links: linkPaths(d.id) });
  }),
);

/** Switch the vehicle or the worker, before it is over. */
deliveryRoutes.put(
  '/admin/deliveries/:id',
  admin,
  handler(async (req, res) => {
    const b = z.object({ vehicleKind: z.enum(['bike', 'car']).optional(), vehicle: z.string().trim().max(40).optional(), personId: z.string().optional(), otpSkipped: z.boolean().optional() }).parse(req.body);
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
    if (b.otpSkipped != null) d.otpSkipped = b.otpSkipped;
    await repo.putDoc('deliveries', d);
    tell(d, was && was !== d.personId ? 'assigned' : undefined);
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
    const [active, recent, people, settings, shopLoc] = await Promise.all([
      repo.listDocs<Delivery>('deliveries', { status: ['pending', 'out'] }),
      repo.listDocs<Delivery>('deliveries', { filter: { status: ['delivered', 'failed'], at: { gte: since } }, sort: { at: -1 }, limit: 50 }),
      repo.listPeople(),
      settingsOf(repo),
      shopOf(repo),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const list = [...active.sort((a, b) => b.at.localeCompare(a.at)), ...recent].map((d) => ({ ...d, personName: d.personId ? (nameOf.get(d.personId) ?? '') : '', links: linkPaths(d.id) }));
    res.json({
      shop: settings.shopLat != null && settings.shopLng != null ? { lat: settings.shopLat, lng: settings.shopLng } : null,
      shopName: shopLoc.name,
      deliveries: list,
    });
  }),
);

/**
 * The road still ahead for a delivery: from the worker's latest position (or the shop, before
 * Start) to the home, through the server's router (see route.ts). Empty when there is no road to
 * show: no pin, no start point, or the router is not answering.
 */
deliveryRoutes.get(
  '/admin/deliveries/:id/route',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const d = await repo.getDoc<Delivery>('deliveries', String(req.params.id));
    if (!d) throw new HttpError(404, 'No such delivery');
    const empty = { points: [], km: null, minutes: null };
    if (!isActiveDelivery(d.status) || d.lat == null || d.lng == null) return res.json(empty);
    const settings = await settingsOf(repo);
    const from = d.status === 'out' && d.pos ? d.pos : settings.shopLat != null && settings.shopLng != null ? { lat: settings.shopLat, lng: settings.shopLng } : null;
    if (!from) return res.json(empty);
    const r = await roadRouter().route({ lat: from.lat, lng: from.lng }, { lat: d.lat, lng: d.lng });
    res.json(r ?? empty);
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
      // Nor the door code: the customer tells it, so it proves the worker was there.
      .map(({ track: _t, by: _b, ...d }) => ({ ...forWorker(d as Delivery), ...(isActiveDelivery(d.status) ? { links: { track: linkPaths(d.id).track } } : {}) }));
    res.json(shown);
  }),
);

deliveryRoutes.post(
  '/worker/deliveries/:id/start',
  worker,
  handler(async (req, res) => {
    const repo = getRepo();
    const d = await ownDelivery(repo, String(req.params.id), req.person!);
    if (d.status === 'out') return res.json(forWorker(d));
    if (d.status !== 'pending') throw new HttpError(409, 'This delivery is already over');
    if (d.lat == null || d.lng == null) throw new HttpError(409, 'There is no pin for the home yet. Wait for the customer’s location, or ask the shop.');
    d.status = 'out';
    d.times.out = now();
    d.track = [];
    await repo.putDoc('deliveries', d);
    tell(d, 'started');
    res.json(forWorker(d));
  }),
);

deliveryRoutes.post(
  '/worker/deliveries/:id/position',
  worker,
  handler(async (req, res) => {
    const b = z.object({ ...latLng, accuracy: z.number().min(0).optional() }).parse(req.body);
    const repo = getRepo();
    const d = await ownDelivery(repo, String(req.params.id), req.person!);
    // Only while on the way: nothing is kept before Start or after it is over.
    if (d.status !== 'out') throw new HttpError(409, 'Start the delivery first');
    const at = now();
    if (d.pos && Date.parse(at) - Date.parse(d.pos.at) < MIN_POSITION_GAP_MS) return res.json({ kept: false });
    const p = { lat: b.lat, lng: b.lng, at };
    // A fix worse than 100 m (indoors, the GPS just waking) would zig-zag the trail: it is not
    // drawn, and it moves the live position only when there is none better yet.
    const rough = b.accuracy != null && b.accuracy > MAX_ACCURACY_M;
    if (rough && d.pos) return res.json({ kept: false });
    d.pos = p;
    if (!rough) d.track = addTrackPoint(d.track, p);
    // Nearby: once, the first time within 300 m of the home.
    const nearNow = !d.nearbyAt && !rough && isNearby(p, d);
    if (nearNow) d.nearbyAt = at;
    // The arrival time, asked again every 30 s or once moved 200 m.
    const e = d.eta;
    const stale = !e || Date.parse(at) - Date.parse(e.at) >= ETA_EVERY_MS || !e.from || distanceKm(e.from, p) >= ETA_MOVED_KM;
    if (stale) {
      const minutes = await etaFrom(d, p);
      if (minutes != null) d.eta = { minutes, at, from: { lat: p.lat, lng: p.lng } };
    }
    await repo.putDoc('deliveries', d);
    if (nearNow) tell(d, 'nearby');
    // Positions go to the admin's map (and the customer's page) only.
    else emit('delivery', { roles: [] }, d.id);
    res.json({ kept: true, ...(d.eta ? { eta: d.eta.minutes } : {}), ...(d.nearbyAt ? { nearby: true } : {}) });
  }),
);

async function finish(req: import('express').Request, status: 'delivered' | 'failed', patch: Partial<Delivery>, check?: (d: Delivery, repo: InvRepo) => Promise<void>) {
  const repo = getRepo();
  const d = await ownDelivery(repo, String(req.params.id), req.person!);
  if (!isActiveDelivery(d.status)) throw new HttpError(409, 'This delivery is already over');
  if (check) await check(d, repo);
  Object.assign(d, patch);
  d.status = status;
  d.times[status] = now();
  // The route is not kept: only where it started and ended.
  d.track = trimTrack(d.track);
  delete d.pos;
  await repo.putDoc('deliveries', d);
  tell(d, status);
  return forWorker(d);
}

deliveryRoutes.post(
  '/worker/deliveries/:id/delivered',
  worker,
  handler(async (req, res) => {
    const b = z
      .object({
        collected: z.number().min(0).max(10_000_000).default(0),
        otp: z.string().trim().max(8).optional(),
        paidBy: z.enum(PAID_BY as unknown as [string, ...string[]]).optional(),
        photo: z.string().max(MAX_PHOTO_CHARS, 'The photo is too big').optional(),
      })
      .parse(req.body);
    if (b.photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo)) throw new HttpError(400, 'That is not a photo');
    const photoId = b.photo ? newId('ph') : undefined;
    const patch: Partial<Delivery> = { collected: b.collected, ...(b.paidBy ? { paidBy: b.paidBy as Delivery['paidBy'] } : {}), ...(photoId ? { photoId } : {}) };
    const d = await finish(req, 'delivered', patch, async (d, repo) => {
      // The door code: needed unless the admin let it go (or the delivery is older than codes).
      if (!d.otp || d.otpSkipped) return;
      if ((d.otpTries ?? 0) >= OTP_MAX_TRIES) throw new HttpError(429, 'Too many wrong codes. Call the shop.');
      if (b.otp !== d.otp) {
        d.otpTries = (d.otpTries ?? 0) + 1;
        await repo.putDoc('deliveries', d);
        const left = OTP_MAX_TRIES - d.otpTries;
        throw new HttpError(left > 0 ? 400 : 429, left > 0 ? 'Wrong code. ' + left + (left === 1 ? ' try left.' : ' tries left.') : 'Too many wrong codes. Call the shop.');
      }
      if (photoId) await repo.putDoc('deliveryPhotos', { id: photoId, deliveryId: d.id, data: b.photo! });
    });
    res.json(d);
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

/** The proof photo: the admin any, a worker only their own delivery's. */
async function sendPhoto(d: Delivery, res: import('express').Response): Promise<void> {
  const ph = d.photoId ? await getRepo().getDoc<{ id: string; deliveryId: string; data: string }>('deliveryPhotos', d.photoId) : null;
  if (!ph || ph.deliveryId !== d.id) throw new HttpError(404, 'No photo');
  res.json({ data: ph.data });
}
deliveryRoutes.get(
  '/admin/deliveries/:id/photo',
  admin,
  handler(async (req, res) => {
    const d = await getRepo().getDoc<Delivery>('deliveries', String(req.params.id));
    if (!d) throw new HttpError(404, 'No such delivery');
    await sendPhoto(d, res);
  }),
);
deliveryRoutes.get(
  '/worker/deliveries/:id/photo',
  worker,
  handler(async (req, res) => {
    await sendPhoto(await ownDelivery(getRepo(), String(req.params.id), req.person!), res);
  }),
);

/** The vehicles of one kind, for the form's vehicle box. */
export const vehiclesOfKind = (all: Vehicle[], kind: 'bike' | 'car') => all.filter((v) => v.active && v.kind === kind);
