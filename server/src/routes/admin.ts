import { Router } from 'express';
import { z } from 'zod';
import {
  ADJUST_REASONS,
  checkItem,
  checkPin,
  describeQty,
  isLow,
  itemMatches,
  itemsFromCsv,
  itemsToCsv,
  lowAtOf,
  normalisePhone,
  parseCsv,
  isActiveRole,
  ROLES,
  ROUND_STEPS,
  toCsv,
  toXlsx,
  totalsByItem,
  type Cell,
  type Item,
  type ItemInput,
  type Location,
  type Role,
  type Vehicle,
} from '@stock/core';
import { anyone, publicPerson, requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { hashPin } from '../pin';
import { post, reconcile } from '../posting';
import { getRepo } from '../store';
import { newId } from '../store/types';
import { placeOrder, settingsOf, shopOf } from '../setup';
import { dropPerson, emit } from '../events';

export const adminRoutes = Router();

const admin = requireRole('admin');

// ---------------------------------------------------------------- people

adminRoutes.get(
  '/people',
  admin,
  handler(async (_req, res) => {
    const people = await getRepo().listPeople();
    res.json(people.map(publicPerson).sort((a, b) => a.name.localeCompare(b.name)));
  }),
);

const personBody = z.object({
  name: z.string().trim().min(1, 'Give a name').max(60),
  phone: z.string().max(20),
  role: z.enum(ROLES),
  linkedId: z.string().max(60).optional(),
  pin: z.string().max(12),
});

/**
 * A godown person must be tied to a godown that exists. A vendor, from when suppliers signed in,
 * keeps whatever supplier they were tied to.
 */
async function checkLink(role: Role, linkedId: string | undefined): Promise<string | undefined> {
  if (role === 'vendor') return linkedId;
  if (role !== 'godown') return undefined;
  const locs = await getRepo().listLocations();
  if (!linkedId || !locs.some((l) => l.id === linkedId && l.kind === 'godown')) {
    throw new HttpError(400, 'Choose which godown this person works at');
  }
  return linkedId;
}

adminRoutes.post(
  '/people',
  admin,
  handler(async (req, res) => {
    const body = personBody.parse(req.body);
    if (body.role === 'vendor') throw new HttpError(400, NO_VENDORS);
    if (!isActiveRole(body.role)) throw new HttpError(400, RETIRED_ROLE);
    const phone = normalisePhone(body.phone);
    if (phone.length !== 10) throw new HttpError(400, 'The phone number should be 10 digits');
    const bad = checkPin(body.pin);
    if (bad) throw new HttpError(400, bad);
    const linkedId = await checkLink(body.role, body.linkedId);
    const rec = {
      id: newId('p'),
      name: body.name,
      phone,
      role: body.role,
      ...(linkedId ? { linkedId } : {}),
      active: true,
      pinHash: hashPin(body.pin),
      tv: 1,
      createdAt: new Date().toISOString(),
    };
    if (!(await getRepo().createPerson(rec))) throw new HttpError(409, 'Someone already has this phone number');
    res.status(201).json(publicPerson(rec));
  }),
);

const NO_VENDORS = 'Suppliers do not sign in any more. Add them under Purchases, Suppliers.';
const RETIRED_ROLE = 'That login is no longer used. Choose Admin, Shop worker or Godown.';

const personPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(ROLES).optional(),
  linkedId: z.string().max(60).optional(),
  active: z.boolean().optional(),
});

adminRoutes.put(
  '/people/:id',
  admin,
  handler(async (req, res) => {
    const patch = personPatch.parse(req.body);
    const repo = getRepo();
    const p = await repo.getPerson(String(req.params.id));
    if (!p) throw new HttpError(404, 'No such person');
    const role = patch.role ?? p.role;
    const active = patch.active ?? p.active;
    if (role === 'vendor' && p.role !== 'vendor') throw new HttpError(400, NO_VENDORS);
    if (role !== p.role && !isActiveRole(role)) throw new HttpError(400, RETIRED_ROLE);
    // The shop must never be left with nobody able to run it.
    if (p.role === 'admin' && (role !== 'admin' || !active)) {
      const admins = (await repo.listPeople()).filter((x) => x.role === 'admin' && x.active);
      if (admins.length <= 1) throw new HttpError(400, 'This is the only admin. Add another admin first.');
    }
    const linkedId = await checkLink(role, patch.linkedId ?? p.linkedId);
    const changed = await repo.updatePerson(p.id, {
      ...(patch.name ? { name: patch.name } : {}),
      role,
      active,
      ...(linkedId ? { linkedId } : {}),
      // A change of role or switching off takes effect on every device at once.
      ...(role !== p.role || active !== p.active ? { tv: p.tv + 1 } : {}),
    });
    if (!changed!.active || changed!.role !== p.role) dropPerson(p.id);
    res.json(publicPerson(changed!));
  }),
);

adminRoutes.post(
  '/people/:id/pin',
  admin,
  handler(async (req, res) => {
    const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body);
    const bad = checkPin(pin);
    if (bad) throw new HttpError(400, bad);
    const repo = getRepo();
    const p = await repo.getPerson(String(req.params.id));
    if (!p) throw new HttpError(404, 'No such person');
    await repo.updatePerson(p.id, { pinHash: hashPin(pin), tv: p.tv + 1 });
    dropPerson(p.id);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- places

adminRoutes.get(
  '/locations',
  anyone,
  handler(async (_req, res) => {
    // The shop first, then godowns by name.
    res.json(placeOrder(await getRepo().listLocations()));
  }),
);

const locationBody = z.object({
  name: z.string().trim().min(1, 'Give the place a name').max(60),
  nameKn: z.string().trim().max(60).default(''),
  address: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
});

adminRoutes.post(
  '/locations',
  admin,
  handler(async (req, res) => {
    const body = locationBody.parse(req.body);
    const loc: Location = {
      id: newId('loc'),
      name: body.name,
      nameKn: body.nameKn,
      kind: 'godown',
      ...(body.address ? { address: body.address } : {}),
      active: true,
    };
    await getRepo().saveLocation(loc);
    res.status(201).json(loc);
  }),
);

adminRoutes.put(
  '/locations/:id',
  admin,
  handler(async (req, res) => {
    const body = locationBody.parse(req.body);
    const repo = getRepo();
    const loc = (await repo.listLocations()).find((l) => l.id === req.params.id);
    if (!loc) throw new HttpError(404, 'No such place');
    if (loc.kind === 'shop' && body.active === false) throw new HttpError(400, 'The shop cannot be switched off');
    const next: Location = {
      ...loc,
      name: body.name,
      nameKn: body.nameKn,
      ...(body.address != null ? { address: body.address } : {}),
      active: body.active ?? loc.active,
    };
    await repo.saveLocation(next);
    res.json(next);
  }),
);

// ---------------------------------------------------------------- items

adminRoutes.get(
  '/items',
  admin,
  handler(async (req, res) => {
    let items = await getRepo().listItems();
    if (req.query.all !== '1') items = items.filter((i) => i.active);
    const q = String(req.query.q ?? '').trim();
    if (q) items = items.filter((i) => itemMatches(i, q));
    items.sort((a, b) => (a.nameEn || a.nameKn).localeCompare(b.nameEn || b.nameKn));
    res.json(items);
  }),
);

adminRoutes.get(
  '/items/:id',
  admin,
  handler(async (req, res) => {
    const item = await getRepo().getItem(String(req.params.id));
    if (!item) throw new HttpError(404, 'No such item');
    res.json(item);
  }),
);

/** Racks may only be keyed by places that exist. */
async function dropUnknownPlaces(input: ItemInput): Promise<ItemInput> {
  const ids = new Set((await getRepo().listLocations()).map((l) => l.id));
  return { ...input, racks: Object.fromEntries(Object.entries(input.racks).filter(([k]) => ids.has(k))) };
}

/**
 * An item as saved over an older one. The old per-place levels are kept as they were (they are
 * never read once lowAt is set); a level the shop cleared is saved as null, so the old ones do
 * not come back in its place.
 */
function keepOld(next: Item, old: Item): Item {
  if (!old.reorderAt) return next;
  return { ...next, reorderAt: old.reorderAt, ...(next.lowAt ? {} : { lowAt: null }) };
}

function checked(body: unknown): ItemInput {
  const r = checkItem(body as ItemInput);
  if (!r.ok) throw new HttpError(400, r.error);
  return r.value;
}

adminRoutes.post(
  '/items',
  admin,
  handler(async (req, res) => {
    const input = await dropUnknownPlaces(checked(req.body));
    const item: Item = { ...input, id: newId('it'), active: true, updatedAt: new Date().toISOString() };
    await getRepo().saveItem(item);
    emit('items');
    res.status(201).json(item);
  }),
);

adminRoutes.put(
  '/items/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const old = await repo.getItem(String(req.params.id));
    if (!old) throw new HttpError(404, 'No such item');
    const input = await dropUnknownPlaces(checked(req.body));
    const item = keepOld({ ...input, id: old.id, active: input.active ?? old.active, updatedAt: new Date().toISOString() }, old);
    await repo.saveItem(item);
    emit('items');
    res.json(item);
  }),
);

// ---------------------------------------------------------------- stock

adminRoutes.get(
  '/stock',
  admin,
  handler(async (_req, res) => {
    res.json(await getRepo().listStock());
  }),
);

adminRoutes.get(
  '/items/:id/moves',
  admin,
  handler(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 30));
    res.json(await getRepo().listMoves({ itemId: String(req.params.id), limit }));
  }),
);

async function itemAndPlace(itemId: string, locationId: string): Promise<{ item: Item; loc: Location }> {
  const repo = getRepo();
  const [item, locs] = await Promise.all([repo.getItem(itemId), repo.listLocations()]);
  const loc = locs.find((l) => l.id === locationId);
  if (!item) throw new HttpError(404, 'No such item');
  if (!loc) throw new HttpError(404, 'No such place');
  return { item, loc };
}

const qtyNumber = z.coerce.number().finite().min(0, 'The count cannot be below zero').max(10_000_000);

/** The first count of an item in a place. Only once: after that, a correction says why. */
adminRoutes.post(
  '/stock/open',
  admin,
  handler(async (req, res) => {
    const body = z.object({ itemId: z.string(), locationId: z.string(), qty: qtyNumber }).parse(req.body);
    const { item, loc } = await itemAndPlace(body.itemId, body.locationId);
    const repo = getRepo();
    const before = await repo.listMoves({ itemId: item.id, locationId: loc.id, limit: 1 });
    if (before.length) throw new HttpError(409, 'This place already has a count for this item. Correct the count instead.');
    const posted = await post(repo, [
      {
        id: newId('mv'),
        key: 'open:' + item.id + ':' + loc.id,
        at: new Date().toISOString(),
        kind: 'open',
        itemId: item.id,
        to: loc.id,
        qty: body.qty,
        ref: 'opening',
        by: req.person!.id,
      },
    ]);
    res.status(201).json({ posted: posted.length });
  }),
);

/**
 * Sets the count of an item in a place to what is actually there, recording the difference as a
 * move with a reason. The difference is taken from the ledger, not the cache, so a correction is
 * right even if the cache had drifted.
 */
adminRoutes.post(
  '/stock/adjust',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({
        itemId: z.string(),
        locationId: z.string(),
        actual: z.coerce.number().finite().min(-10_000_000).max(10_000_000),
        reason: z.enum(ADJUST_REASONS),
        note: z.string().trim().max(200).optional(),
        /** Sent by the screen so a double tap posts once. */
        requestId: z.string().max(60).optional(),
      })
      .parse(req.body);
    const { item, loc } = await itemAndPlace(body.itemId, body.locationId);
    const repo = getRepo();
    const levels = await repo.ledgerLevels([item.id]);
    const now = levels.find((l) => l.locationId === loc.id)?.qty ?? 0;
    const delta = Math.round((body.actual - now) * 1000) / 1000;
    if (delta === 0) {
      res.json({ posted: 0, qty: now });
      return;
    }
    const posted = await post(repo, [
      {
        id: newId('mv'),
        key: 'adj:' + (body.requestId ?? newId('r')),
        at: new Date().toISOString(),
        kind: 'adjust',
        itemId: item.id,
        ...(delta < 0 ? { from: loc.id } : { to: loc.id }),
        qty: Math.abs(delta),
        ref: body.reason,
        by: req.person!.id,
        ...(body.note ? { note: body.note } : {}),
      },
    ]);
    res.json({ posted: posted.length, qty: body.actual });
  }),
);

adminRoutes.post(
  '/stock/recount',
  admin,
  handler(async (_req, res) => {
    res.json(await reconcile(getRepo()));
  }),
);

// ---------------------------------------------------------------- settings

adminRoutes.get(
  '/admin/settings',
  admin,
  handler(async (_req, res) => {
    res.json(await settingsOf(getRepo()));
  }),
);

adminRoutes.put(
  '/admin/settings',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({ roundTo: z.number().refine((n) => (ROUND_STEPS as readonly number[]).includes(n), 'Round to none, 1, 5 or 10 rupees') })
      .parse(req.body);
    const repo = getRepo();
    const next = { ...(await settingsOf(repo)), roundTo: body.roundTo as (typeof ROUND_STEPS)[number] };
    await repo.putDoc('meta', { id: 'settings', ...next });
    // Every screen showing a bill total shows it rounded the new way.
    emit('bills');
    res.json(next);
  }),
);

// ---------------------------------------------------------------- vehicles

const vehicleBody = z.object({
  number: z.string().trim().min(1, 'Give the vehicle number').max(40),
  type: z.string().trim().max(30).default(''),
  driverName: z.string().trim().max(60).default(''),
  driverPhone: z.string().trim().max(20).default(''),
  active: z.boolean().optional(),
});

/** "KA-17 AB 1234" and "ka17ab1234" are the same vehicle. */
export const vehicleKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0c80-\u0cff]/g, '');

/** The same number twice would make "trips by vehicle" count one vehicle as two. */
async function checkVehicle(b: z.infer<typeof vehicleBody>, id?: string): Promise<string> {
  const phone = b.driverPhone ? normalisePhone(b.driverPhone) : '';
  if (b.driverPhone && phone.length !== 10) throw new HttpError(400, 'The driver\'s phone should be 10 digits');
  const all = await getRepo().listDocs<Vehicle>('vehicles');
  if (all.some((v) => v.id !== id && vehicleKey(v.number) === vehicleKey(b.number))) throw new HttpError(409, 'This vehicle is already in the list');
  return phone;
}

adminRoutes.get(
  '/admin/vehicles',
  admin,
  handler(async (_req, res) => {
    const all = await getRepo().listDocs<Vehicle>('vehicles');
    res.json(all.sort((a, b) => Number(b.active) - Number(a.active) || a.number.localeCompare(b.number)));
  }),
);

adminRoutes.post(
  '/admin/vehicles',
  admin,
  handler(async (req, res) => {
    const b = vehicleBody.parse(req.body);
    const phone = await checkVehicle(b);
    const v: Vehicle = { id: newId('veh'), number: b.number, type: b.type, driverName: b.driverName, driverPhone: phone, active: true };
    await getRepo().putDoc('vehicles', v);
    res.status(201).json(v);
  }),
);

adminRoutes.put(
  '/admin/vehicles/:id',
  admin,
  handler(async (req, res) => {
    const b = vehicleBody.parse(req.body);
    const repo = getRepo();
    const old = await repo.getDoc<Vehicle>('vehicles', String(req.params.id));
    if (!old) throw new HttpError(404, 'No such vehicle');
    const phone = await checkVehicle(b, old.id);
    const v: Vehicle = { ...old, number: b.number, type: b.type, driverName: b.driverName, driverPhone: phone, active: b.active ?? old.active };
    await repo.putDoc('vehicles', v);
    res.json(v);
  }),
);

/** Past trips keep the number written on them, so removing a vehicle loses no history. */
adminRoutes.delete(
  '/admin/vehicles/:id',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    if (!(await repo.getDoc<Vehicle>('vehicles', String(req.params.id)))) throw new HttpError(404, 'No such vehicle');
    await repo.deleteDoc('vehicles', String(req.params.id));
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- files

/** A shop day starts at midnight in India, wherever the server is. */
function istDayStart(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Dates are YYYY-MM-DD');
  return new Date(day + 'T00:00:00+05:30').toISOString();
}

function sendCsv(res: import('express').Response, name: string, body: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.send(body);
}

adminRoutes.get(
  '/export/items.csv',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, shop] = await Promise.all([repo.listItems(), shopOf(repo)]);
    items.sort((a, b) => (a.nameEn || a.nameKn).localeCompare(b.nameEn || b.nameKn));
    sendCsv(res, 'items.csv', itemsToCsv(items, shop.id));
  }),
);

function sendXlsx(res: import('express').Response, name: string, body: Uint8Array): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.send(Buffer.from(body));
}

/** The items file as an Excel workbook: the same columns as items.csv. */
adminRoutes.get(
  '/export/items.xlsx',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, shop] = await Promise.all([repo.listItems(), shopOf(repo)]);
    items.sort((a, b) => (a.nameEn || a.nameKn).localeCompare(b.nameEn || b.nameKn));
    const [header = [], ...rows] = parseCsv(itemsToCsv(items, shop.id)).filter((r) => r.some((c) => c !== ''));
    // Numbers go in as numbers, so a price can be summed; everything else stays text.
    const typed: Cell[][] = rows.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) && !/^0\d/.test(c) ? Number(c) : c)));
    sendXlsx(res, 'items.xlsx', toXlsx([{ name: 'Items', header, rows: typed }]));
  }),
);

/** The running-out level as the shop typed it: "2 box". */
function lowWords(it: Item): string {
  const l = lowAtOf(it);
  return l ? l.qty + ' ' + l.unit : '';
}

/** Below zero is about this place; running low is about all places together. */
function stockStatus(it: Item, q: number, total: number): string {
  return q < 0 ? 'below zero' : isLow(it, total) ? 'running low' : '';
}

/** Stock as a workbook: one sheet per place, the shop first, the same columns as stock.csv. */
adminRoutes.get(
  '/export/stock.xlsx',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, locs, stock] = await Promise.all([repo.listItems(), repo.listLocations(), repo.listStock()]);
    const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
    const totals = totalsByItem(stock);
    const sheets = placeOrder(locs).map((loc) => ({
      name: loc.name,
      header: ['item_id', 'name_en', 'name_kn', 'qty_base', 'base_unit', 'as_units', 'rack', 'total_all_places', 'running_out_below', 'status'],
      rows: items
        .filter((i) => i.active)
        .map((it) => {
          const q = qty.get(it.id + '|' + loc.id) ?? 0;
          const total = totals.get(it.id) ?? 0;
          return [it.id, it.nameEn, it.nameKn, q, it.units[0]!.code, describeQty(it, q), it.racks[loc.id] ?? '', total, lowWords(it), stockStatus(it, q, total)];
        }),
    }));
    sendXlsx(res, 'stock.xlsx', toXlsx(sheets));
  }),
);

adminRoutes.get(
  '/export/stock.csv',
  admin,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, locs, stock] = await Promise.all([repo.listItems(), repo.listLocations(), repo.listStock()]);
    const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
    const totals = totalsByItem(stock);
    const rows: (string | number)[][] = [];
    for (const it of items.filter((i) => i.active)) {
      const total = totals.get(it.id) ?? 0;
      for (const loc of locs) {
        const q = qty.get(it.id + '|' + loc.id) ?? 0;
        rows.push([
          it.id,
          it.nameEn,
          it.nameKn,
          loc.name,
          q,
          it.units[0]!.code,
          describeQty(it, q),
          it.racks[loc.id] ?? '',
          total,
          lowWords(it),
          stockStatus(it, q, total),
        ]);
      }
    }
    sendCsv(
      res,
      'stock.csv',
      toCsv(['item_id', 'name_en', 'name_kn', 'place', 'qty_base', 'base_unit', 'as_units', 'rack', 'total_all_places', 'running_out_below', 'status'], rows),
    );
  }),
);

adminRoutes.get(
  '/export/ledger.csv',
  admin,
  handler(async (req, res) => {
    const repo = getRepo();
    const from = req.query.from ? istDayStart(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(Date.parse(istDayStart(String(req.query.to))) + 86_400_000).toISOString() : undefined;
    const [moves, items, locs, people] = await Promise.all([
      repo.listMoves({ ...(from ? { from } : {}), ...(to ? { to } : {}) }),
      repo.listItems(),
      repo.listLocations(),
      repo.listPeople(),
    ]);
    const itemName = new Map(items.map((i) => [i.id, i.nameEn || i.nameKn]));
    const placeName = new Map(locs.map((l) => [l.id, l.name]));
    const who = new Map(people.map((p) => [p.id, p.name]));
    const rows = moves
      .reverse()
      .map((m) => [
        m.at,
        m.kind,
        m.itemId,
        itemName.get(m.itemId) ?? '',
        m.from ? placeName.get(m.from) ?? m.from : '',
        m.to ? placeName.get(m.to) ?? m.to : '',
        m.qty,
        m.ref,
        who.get(m.by) ?? m.by,
        m.note ?? '',
      ]);
    sendCsv(res, 'ledger.csv', toCsv(['at', 'kind', 'item_id', 'item', 'from', 'to', 'qty_base', 'ref', 'by', 'note'], rows));
  }),
);

/** The parts of an item a spreadsheet can change, for telling "changed" from "unchanged". */
function comparable(i: ItemInput): string {
  return JSON.stringify([i.nameEn, i.nameKn, i.category ?? '', i.units, i.aliases, i.racks, lowAtOf(i) ?? null, i.active ?? true]);
}

/**
 * Brings in the items spreadsheet. All or nothing: if any row has a problem, nothing is changed
 * and every problem is listed, so a half-imported catalogue never happens. `dry` only reports.
 */
adminRoutes.post(
  '/import/items',
  admin,
  handler(async (req, res) => {
    const { csv, dry } = z.object({ csv: z.string().max(2_000_000), dry: z.boolean().default(true) }).parse(req.body);
    const repo = getRepo();
    const [existing, shop] = await Promise.all([repo.listItems(), shopOf(repo)]);
    const byId = new Map(existing.map((i) => [i.id, i]));
    const parsed = itemsFromCsv(csv, shop.id);
    const errors = [...parsed.errors];
    const ready: { input: ItemInput; old?: Item }[] = [];

    for (const [i, raw] of parsed.items.entries()) {
      const row = parsed.rows[i] ?? 0;
      const old = raw.id ? byId.get(raw.id) : undefined;
      if (raw.id && !old) {
        errors.push({ row, message: 'item_id "' + raw.id + '" is not in the shop. Leave item_id empty for a new item.' });
        continue;
      }
      // Keep racks for godowns: the spreadsheet only carries the shop's. An empty low_at keeps
      // the level the item has.
      const oldLow = old ? lowAtOf(old) : undefined;
      const merged: ItemInput = old
        ? { ...raw, racks: { ...old.racks, ...raw.racks }, ...(!raw.lowAt && !raw.reorderAt && oldLow ? { lowAt: oldLow } : {}), active: raw.active ?? old.active }
        : raw;
      const r = checkItem(merged);
      if (!r.ok) {
        errors.push({ row, message: (raw.nameEn || raw.nameKn || raw.id || 'An item') + ': ' + r.error });
        continue;
      }
      ready.push({ input: r.value, ...(old ? { old } : {}) });
    }

    const added = ready.filter((r) => !r.old).length;
    const changed = ready.filter((r) => r.old && comparable(r.input) !== comparable(r.old)).length;
    const unchanged = ready.length - added - changed;

    if (!dry && errors.length === 0) {
      const now = new Date().toISOString();
      for (const r of ready) {
        if (r.old && comparable(r.input) === comparable(r.old)) continue;
        const next: Item = { ...r.input, id: r.old?.id ?? newId('it'), active: r.input.active ?? true, updatedAt: now };
        await repo.saveItem(r.old ? keepOld(next, r.old) : next);
      }
    }
    res.json({ added, changed, unchanged, errors, applied: !dry && errors.length === 0 });
  }),
);
