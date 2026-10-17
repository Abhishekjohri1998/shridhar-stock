import { Router } from 'express';
import { z } from 'zod';
import {
  findUnit,
  landedUnitCost,
  splitCharge,
  unitCostsFrom,
  type CarrierTrip,
  type Lot,
  poStage,
  searchKey,
  toBase,
  type BillMirror,
  type Ink,
  type Item,
  type PurchaseOrder,
  type StockMove,
  type Supplier,
  type CustomerProfile,
  type Transfer,
} from '@stock/core';
import { requireRole, audit } from '../auth';
import { handler, HttpError } from '../http';
import { post } from '../posting';
import { getRepo } from '../store';
import { newId } from '../store/types';
import { emit } from '../events';
import { pushAddress } from '../billing/push';

/**
 * The things people do, each checked for who may do it and on what, and each moving stock
 * through the ledger with a key that cannot be posted twice.
 */
export const actionRoutes = Router();

const admin = requireRole('admin');
const now = () => new Date().toISOString();

const inkBody = z
  .object({ w: z.number().positive().max(4000), h: z.number().positive().max(2000), strokes: z.array(z.array(z.number()).max(4000)).max(400) })
  .optional();

// ---------------------------------------------------------------- confirming bill lines

/** What a person says one bill line was: an item in a unit, or not stock at all. */
const answerBody = z.object({
  i: z.number().int().min(0),
  itemId: z.string().optional(),
  unit: z.string().optional(),
  qty: z.number().positive().max(100000).optional(),
  notItem: z.boolean().optional(),
});
type Answer = z.infer<typeof answerBody>;

/** What confirming lines of one bill needs, read once however many lines there are. */
interface ConfirmContext {
  bill: BillMirror;
  items: Map<string, Item>;
  shopId: string;
  by: string;
  learn: boolean;
  /** Items that learnt a name, saved once at the end. */
  changedItems: Set<string>;
}

async function confirmContext(billNo: number, by: string, learn: boolean): Promise<ConfirmContext> {
  const repo = getRepo();
  const [bill, items, locs] = await Promise.all([repo.getDoc<BillMirror>('bills', String(billNo)), repo.listItems(), repo.listLocations()]);
  if (!bill) throw new HttpError(404, 'No such bill');
  const shop = locs.find((l) => l.kind === 'shop')!;
  return { bill, items: new Map(items.map((i) => [i.id, i])), shopId: shop.id, by, learn, changedItems: new Set() };
}

/**
 * One line's answer, applied to a bill already read. Shared by the one-line confirm and "confirm
 * all on this bill", so the two can never disagree.
 *
 * The sale moves stock, and what the handwriting was read as becomes another name for the item,
 * so the same writing is recognised next time. Returns the name learnt, if any.
 */
async function confirmLine(ctx: ConfirmContext, a: Answer): Promise<{ learnt: string }> {
  const { bill } = ctx;
  const line = bill.lines.find((l) => l.i === a.i);
  if (!line) throw new HttpError(404, 'No such line');
  if (line.state !== 'to-confirm') throw new HttpError(409, 'This line is already done');
  if (a.notItem) {
    line.state = 'not-item';
    return { learnt: '' };
  }
  if (!a.itemId || !a.unit || !a.qty) throw new HttpError(400, 'Choose the item, unit and quantity');
  const item = ctx.items.get(a.itemId);
  if (!item) throw new HttpError(404, 'No such item');
  if (!findUnit(item, a.unit)) throw new HttpError(400, 'That item has no unit "' + a.unit + '"');
  const baseQty = toBase(item, a.unit, a.qty);

  line.state = 'confirmed';
  line.itemId = item.id;
  line.unit = a.unit;
  line.baseQty = baseQty;
  if (line.reading) line.reading = { ...line.reading, by: ctx.by, at: now() };
  await post(getRepo(), [
    { id: newId('mv'), key: 'sale:' + bill.no + ':' + line.i, at: now(), kind: line.ink ? 'digitise' : 'sale', itemId: item.id, from: ctx.shopId, qty: baseQty, ref: 'bill ' + bill.no + ' line ' + (line.i + 1), by: ctx.by },
  ]);

  // Learn the name it was written or typed as.
  const said = (line.reading?.readText || line.name || '').replace(/^\s*[\d.]+\s*(kg|g|l|pc|pack|line|box)?\s*/i, '').trim();
  if (!ctx.learn || !said || said.length > 60) return { learnt: '' };
  const key = searchKey(said);
  const known = [item.nameEn, item.nameKn, ...item.aliases.map((x) => x.text)].some((t) => searchKey(t) === key);
  if (known || item.aliases.length >= 20) return { learnt: '' };
  item.aliases.push({ text: said, unit: a.unit === item.units[0]!.code ? undefined : a.unit });
  item.aliases = item.aliases.map((x) => (x.unit ? x : { text: x.text }));
  item.updatedAt = now();
  ctx.changedItems.add(item.id);
  return { learnt: said };
}

/** Saves what confirming changed: the bill, and any item that learnt a name. */
async function confirmSave(ctx: ConfirmContext): Promise<void> {
  const repo = getRepo();
  await repo.putDoc('bills', ctx.bill);
  for (const id of ctx.changedItems) await repo.saveItem(ctx.items.get(id)!);
  emit('bills');
  if (ctx.changedItems.size) emit('items');
}

actionRoutes.post(
  '/admin/confirm',
  admin,
  handler(async (req, res) => {
    const body = answerBody.extend({ billNo: z.number().int().positive(), learn: z.boolean().default(true) }).parse(req.body);
    const ctx = await confirmContext(body.billNo, req.person!.id, body.learn);
    const { learnt } = await confirmLine(ctx, body);
    await confirmSave(ctx);
    res.json(body.notItem ? { ok: true } : { ok: true, learnt });
  }),
);

/**
 * "Confirm all on this bill": every line given, each on its own. A line that cannot be confirmed
 * (already done, an item or unit that does not exist) is reported and the rest still go through.
 */
actionRoutes.post(
  '/admin/confirm/bill',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({ billNo: z.number().int().positive(), lines: z.array(answerBody).min(1).max(200), learn: z.boolean().default(true) })
      .parse(req.body);
    const ctx = await confirmContext(body.billNo, req.person!.id, body.learn);
    const done: { i: number; learnt: string }[] = [];
    const failed: { i: number; error: string }[] = [];
    for (const a of body.lines) {
      try {
        done.push({ i: a.i, ...(await confirmLine(ctx, a)) });
      } catch (err) {
        failed.push({ i: a.i, error: err instanceof HttpError ? err.message : 'Could not confirm this line' });
      }
    }
    if (done.length) await confirmSave(ctx);
    res.json({ ok: failed.length === 0, done, failed });
  }),
);

// ---------------------------------------------------------------- the billing link

actionRoutes.post(
  '/admin/link/sync',
  admin,
  handler(async (_req, res) => {
    const { linkConfigured, syncNow } = await import('../billing/link');
    if (!linkConfigured()) throw new HttpError(400, 'The link to billing is not set up (BILLING_URL and BILLING_PIN on the server)');
    const r = await syncNow(true);
    if (!r) throw new HttpError(502, 'Could not read from billing. See the link status.');
    res.json(r);
  }),
);

// ---------------------------------------------------------------- transfers

const transferLines = z.array(z.object({ itemId: z.string(), qty: z.number().positive().max(1e6) })).min(1).max(100);

actionRoutes.post(
  '/admin/transfers',
  admin,
  handler(async (req, res) => {
    const body = z.object({ from: z.string(), to: z.string(), lines: transferLines, note: z.string().max(200).optional() }).parse(req.body);
    const repo = getRepo();
    const locs = await repo.listLocations();
    if (!locs.some((l) => l.id === body.from && l.active) || !locs.some((l) => l.id === body.to && l.active) || body.from === body.to) throw new HttpError(400, 'Choose two different places');
    const known = new Set((await repo.listItems()).map((i) => i.id));
    if (body.lines.some((l) => !known.has(l.itemId))) throw new HttpError(400, 'An item on this transfer does not exist');
    if (new Set(body.lines.map((l) => l.itemId)).size !== body.lines.length) throw new HttpError(400, 'An item is on this transfer twice');
    const no = await repo.nextNo('transfer');
    const t: Transfer = { id: 'tr_' + no, no, from: body.from, to: body.to, lines: body.lines, status: 'requested', at: now(), times: { requested: now() }, ...(body.note ? { note: body.note } : {}) };
    await repo.putDoc('transfers', t);
    emit('transfers', { locationIds: [t.from, t.to] }, t.id);
    res.status(201).json(t);
  }),
);

async function loadTransfer(id: string): Promise<Transfer> {
  const t = await getRepo().getDoc<Transfer>('transfers', id);
  if (!t) throw new HttpError(404, 'No such transfer');
  return t;
}

/** Who may send or receive a transfer: the admin or any worker (the godown job is part of Worker). */
function mayAct(req: import('express').Request, _place: string) {
  const p = req.person!;
  if (p.role === 'admin' || p.role === 'worker' || p.role === 'godown') return;
  throw new HttpError(403, 'This is not open to your role');
}

actionRoutes.post(
  '/transfers/:id/cancel',
  admin,
  handler(async (req, res) => {
    const t = await loadTransfer(String(req.params.id));
    if (t.status !== 'requested') throw new HttpError(409, t.status === 'sent' ? 'It is already on the way: receive it, with what actually arrives' : 'Already ' + t.status);
    t.status = 'cancelled';
    t.times.cancelled = now();
    await getRepo().putDoc('transfers', t);
    emit('transfers', { locationIds: [t.from, t.to] }, t.id);
    res.json(t);
  }),
);

actionRoutes.post(
  '/transfers/:id/send',
  requireRole('admin', 'worker', 'godown'),
  handler(async (req, res) => {
    const body = z
      .object({ vehicle: z.string().max(40).optional(), driver: z.string().max(40).optional(), note: z.string().max(200).optional(), noteInk: inkBody, sent: z.record(z.string(), z.number().min(0).max(1e6)).optional() })
      .parse(req.body);
    const t = await loadTransfer(String(req.params.id));
    mayAct(req, t.from);
    if (t.status !== 'requested') throw new HttpError(409, 'Already ' + t.status);
    for (const l of t.lines) {
      const v = body.sent?.[l.itemId];
      if (v != null && v > l.qty) throw new HttpError(400, 'Cannot send more than was asked for. Ask the shop to change the request.');
    }
    if (t.lines.every((l) => (body.sent?.[l.itemId] ?? l.qty) === 0)) throw new HttpError(400, 'Nothing is being sent. Cancel the request instead.');
    t.lines = t.lines.map((l) => ({ ...l, sent: body.sent?.[l.itemId] ?? l.qty }));
    t.status = 'sent';
    t.times.sent = now();
    if (body.vehicle) t.vehicle = body.vehicle;
    if (body.driver) t.driver = body.driver;
    if (body.note) t.note = body.note;
    if (body.noteInk) t.noteInk = body.noteInk as Ink;
    const moves: StockMove[] = t.lines.map((l) => ({ id: newId('mv'), key: 'xfer:' + t.no + ':out:' + l.itemId, at: now(), kind: 'transfer_out', itemId: l.itemId, from: t.from, qty: l.sent ?? 0, ref: 'transfer ' + t.no, ...audit(req) }));
    await getRepo().putDoc('transfers', t);
    await post(getRepo(), moves);
    emit('transfers', { locationIds: [t.from, t.to] }, t.id);
    res.json(t);
  }),
);

actionRoutes.post(
  '/transfers/:id/receive',
  requireRole('admin', 'worker', 'godown'),
  handler(async (req, res) => {
    const body = z.object({ received: z.record(z.string(), z.number().min(0).max(1e6)).optional(), note: z.string().max(200).optional() }).parse(req.body);
    const t = await loadTransfer(String(req.params.id));
    mayAct(req, t.to);
    if (t.status !== 'sent') throw new HttpError(409, t.status === 'requested' ? 'Not sent yet' : 'Already ' + t.status);
    for (const l of t.lines) {
      const v = body.received?.[l.itemId];
      if (v != null && v > (l.sent ?? l.qty)) throw new HttpError(400, 'More received than was sent: count again, or record the extra as a correction.');
    }
    t.lines = t.lines.map((l) => ({ ...l, received: body.received?.[l.itemId] ?? l.sent ?? l.qty }));
    t.status = 'received';
    t.times.received = now();
    if (body.note) t.note = body.note;
    const moves: StockMove[] = t.lines.map((l) => ({ id: newId('mv'), key: 'xfer:' + t.no + ':in:' + l.itemId, at: now(), kind: 'transfer_in', itemId: l.itemId, to: t.to, qty: l.received ?? 0, ref: 'transfer ' + t.no, ...audit(req), ...((l.received ?? 0) < (l.sent ?? 0) ? { note: (l.sent! - l.received!) + ' short' } : {}) }));
    await getRepo().putDoc('transfers', t);
    await post(getRepo(), moves);
    emit('transfers', { locationIds: [t.from, t.to] }, t.id);
    res.json(t);
  }),
);

// ---------------------------------------------------------------- suppliers

const supplierBody = z.object({
  name: z.string().trim().min(1, 'Give the supplier a name').max(80),
  /** The company's phone: optional. */
  phone: z.string().trim().max(20).default(''),
  address: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(300).optional(),
  gst: z.string().trim().max(20).optional(),
  contacts: z
    .array(z.object({ name: z.string().trim().min(1, 'Give each contact a name').max(80), role: z.string().trim().max(40).optional(), phone: z.string().trim().max(20).optional() }))
    .max(20)
    .optional(),
  /** The items they supply. Kept on each item (`item.suppliers`), so both sides always agree. */
  itemIds: z.array(z.string()).max(5000).optional(),
  active: z.boolean().optional(),
});

/** The optional fields, written only when given, blank ones dropped. */
function supplierExtras(b: z.infer<typeof supplierBody>, old?: Supplier): Partial<Supplier> {
  const out: Partial<Supplier> = {};
  const gst = b.gst ?? old?.gst;
  if (gst) out.gst = gst.toUpperCase();
  const contacts = (b.contacts ?? old?.contacts ?? []).map((c) => ({ name: c.name, ...(c.role ? { role: c.role } : {}), ...(c.phone ? { phone: c.phone } : {}) }));
  if (contacts.length) out.contacts = contacts;
  return out;
}

/** Item <-> supplier: this supplier ends up on exactly the given items' supplier lists. */
async function syncSupplierItems(supplierId: string, itemIds: string[] | undefined): Promise<boolean> {
  if (!itemIds) return false;
  const repo = getRepo();
  const want = new Set(itemIds);
  let changed = false;
  for (const it of await repo.listItems()) {
    const has = (it.suppliers ?? []).includes(supplierId);
    if (has === want.has(it.id)) continue;
    const list = has ? it.suppliers!.filter((x) => x !== supplierId) : [...(it.suppliers ?? []), supplierId];
    if (list.length) it.suppliers = list;
    else delete it.suppliers;
    it.updatedAt = now();
    await repo.saveItem(it);
    changed = true;
  }
  return changed;
}

actionRoutes.post(
  '/admin/suppliers',
  admin,
  handler(async (req, res) => {
    const b = supplierBody.parse(req.body);
    const s: Supplier = { id: newId('sup'), name: b.name, phone: b.phone, ...(b.address ? { address: b.address } : {}), ...(b.notes ? { notes: b.notes } : {}), ...supplierExtras(b), active: true };
    await getRepo().putDoc('suppliers', s);
    if (await syncSupplierItems(s.id, b.itemIds)) emit('items');
    res.status(201).json(s);
  }),
);

actionRoutes.put(
  '/admin/suppliers/:id',
  admin,
  handler(async (req, res) => {
    const b = supplierBody.parse(req.body);
    const repo = getRepo();
    const old = await repo.getDoc<Supplier>('suppliers', String(req.params.id));
    if (!old) throw new HttpError(404, 'No such supplier');
    const { gst: _g, contacts: _c, ...rest } = old;
    const s: Supplier = { ...rest, name: b.name, phone: b.phone, ...(b.address != null ? { address: b.address } : {}), ...(b.notes != null ? { notes: b.notes } : {}), ...supplierExtras(b, old), active: b.active ?? old.active };
    await repo.putDoc('suppliers', s);
    if (await syncSupplierItems(s.id, b.itemIds)) emit('items');
    res.json(s);
  }),
);

/** The items a supplier supplies, read from the items themselves. */
actionRoutes.get(
  '/admin/suppliers/:id/items',
  admin,
  handler(async (req, res) => {
    const id = String(req.params.id);
    const items = (await getRepo().listItems()).filter((i) => (i.suppliers ?? []).includes(id));
    res.json(items.map((i) => ({ id: i.id, nameEn: i.nameEn, nameKn: i.nameKn })));
  }),
);

// ---------------------------------------------------------------- purchase orders

/*
 * Purchases are the admin's alone: an order is saved as ordered, then received (the goods go
 * into the chosen place) or cancelled. Suppliers do not sign in. Orders saved as confirmed or
 * dispatched, from when they did, are open orders like any other.
 */

/** Every item named on an order, in one read, refusing any that does not exist. */
async function itemsFor(ids: string[]): Promise<Map<string, Item>> {
  const want = new Set(ids);
  const items = new Map((await getRepo().listItems()).filter((i) => want.has(i.id)).map((i) => [i.id, i]));
  if (items.size !== want.size) throw new HttpError(400, 'An item on this order does not exist');
  return items;
}

actionRoutes.post(
  '/admin/pos',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({
        supplierId: z.string(),
        to: z.string(),
        lines: z.array(z.object({ itemId: z.string(), unit: z.string(), qty: z.number().positive().max(1e6), cost: z.number().min(0).max(1e7).default(0) })).min(1).max(100),
      })
      .parse(req.body);
    const repo = getRepo();
    const [sup, locs, items] = await Promise.all([repo.getDoc<Supplier>('suppliers', body.supplierId), repo.listLocations(), itemsFor(body.lines.map((l) => l.itemId))]);
    if (!sup || !sup.active) throw new HttpError(404, 'No such supplier');
    if (!locs.some((l) => l.id === body.to && l.active)) throw new HttpError(400, 'Choose where the goods go');
    if (new Set(body.lines.map((l) => l.itemId)).size !== body.lines.length) throw new HttpError(400, 'An item is on this order twice');
    for (const l of body.lines) {
      const item = items.get(l.itemId)!;
      if (!findUnit(item, l.unit)) throw new HttpError(400, item.nameEn + ' has no unit "' + l.unit + '"');
    }
    const no = await repo.nextNo('po');
    const p: PurchaseOrder = { id: 'po_' + no, no, supplierId: body.supplierId, to: body.to, lines: body.lines, status: 'ordered', at: now(), times: { ordered: now() } };
    await repo.putDoc('pos', p);
    emit('pos', {}, p.id);
    res.status(201).json(p);
  }),
);

async function loadPo(id: string): Promise<PurchaseOrder> {
  const p = await getRepo().getDoc<PurchaseOrder>('pos', id);
  if (!p) throw new HttpError(404, 'No such order');
  return p;
}

actionRoutes.post(
  '/admin/pos/:id/cancel',
  admin,
  handler(async (req, res) => {
    const p = await loadPo(String(req.params.id));
    if (poStage(p.status) !== 'ordered') throw new HttpError(409, 'Already ' + p.status);
    p.status = 'cancelled';
    p.times.cancelled = now();
    await getRepo().putDoc('pos', p);
    emit('pos', {}, p.id);
    res.json({ ok: true });
  }),
);

actionRoutes.post(
  '/admin/pos/:id/receive',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({
        /** Per item: what arrived (in the order's unit) and what it cost per unit. */
        got: z.record(z.string(), z.object({ qty: z.number().min(0).max(1e6), cost: z.number().min(0).max(1e7).optional() })).optional(),
        /** Where the goods went, when not where the order said. */
        to: z.string().optional(),
        updateCost: z.boolean().default(false),
        /** The delivery charge to spread over what arrived: typed in, or taken from a carrier trip. */
        delivery: z.number().min(0).max(1e7).optional(),
        tripId: z.string().optional(),
        /** Per item, an optional expiry date: the goods become a lot, sold first-expiring-first. */
        expiry: z.record(z.string(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry as a date')).optional(),
      })
      .parse(req.body ?? {});
    const p = await loadPo(String(req.params.id));
    if (poStage(p.status) !== 'ordered') throw new HttpError(409, 'Already ' + p.status);
    const repo = getRepo();
    // One read for every item on the order. An item deleted since is received as a record only.
    const want = new Set(p.lines.map((l) => l.itemId));
    const [all, locs] = await Promise.all([repo.listItems(), repo.listLocations()]);
    const items = new Map(all.filter((i) => want.has(i.id)).map((i) => [i.id, i]));
    const to = body.to ?? p.to;
    if (!locs.some((l) => l.id === to && l.active)) throw new HttpError(400, 'Choose where the goods go');
    const moves: StockMove[] = [];
    const received: { itemId: string; qty: number; cost: number; delivery?: number; landed?: number; expiry?: string }[] = [];
    const costChanged = new Set<string>();
    // The delivery charge: typed in, else the linked carrier trip's.
    let trip: CarrierTrip | null = null;
    if (body.tripId) {
      trip = await repo.getDoc<CarrierTrip>('trips', body.tripId);
      if (!trip) throw new HttpError(404, 'No such trip');
      if (trip.poId && trip.poId !== p.id) throw new HttpError(409, 'That trip is already linked to another receipt');
    }
    const charge = body.delivery ?? trip?.charge ?? 0;
    const got = p.lines.map((l) => {
      const g = body.got?.[l.itemId];
      return { l, qty: g?.qty ?? l.qty, cost: g?.cost ?? l.cost };
    });
    for (const g of got) if (g.qty > g.l.qty) throw new HttpError(400, 'More received than ordered: count again, or order the rest separately.');
    // Shared by value (qty x cost) when every line has a cost, else by quantity; nothing to lines that did not come.
    const arrived = got.filter((g) => g.qty > 0);
    const shareList = splitCharge(arrived.map((g) => ({ qty: g.qty, value: g.qty * g.cost })), charge);
    const shareOf = new Map(arrived.map((g, i) => [g.l.itemId, shareList[i]!]));
    const lots: Lot[] = [];
    for (const { l, qty, cost } of got) {
      const share = shareOf.get(l.itemId) ?? 0;
      const landed = landedUnitCost(cost, qty, share);
      const expiry = body.expiry?.[l.itemId];
      received.push({ itemId: l.itemId, qty, cost, ...(share ? { delivery: share, landed } : {}), ...(expiry ? { expiry } : {}) });
      const item = items.get(l.itemId);
      if (!item || qty === 0) continue;
      const baseQty = toBase(item, l.unit, qty);
      moves.push({ id: newId('mv'), key: 'po:' + p.no + ':' + l.itemId, at: now(), kind: 'purchase', itemId: l.itemId, to, qty: baseQty, ref: 'order ' + p.no, by: req.person!.id, ...(qty < l.qty ? { note: l.qty - qty + ' ' + l.unit + ' short' } : {}) });
      if (expiry) lots.push({ id: newId('lot'), itemId: l.itemId, placeId: to, qty: baseQty, expiry, receivedAt: now(), ref: 'order ' + p.no });
      // The landed cost becomes the item's last cost, every other unit worked out from it, when the admin says so.
      if (body.updateCost) {
        const units = unitCostsFrom(item.units, l.unit, landed);
        if (JSON.stringify(units) !== JSON.stringify(item.units)) {
          item.units = units;
          item.updatedAt = now();
          costChanged.add(item.id);
        }
      }
    }
    for (const id of costChanged) await repo.saveItem(items.get(id)!);
    (p as PurchaseOrder & { received?: typeof received }).received = received;
    p.to = to;
    p.status = 'received';
    p.times.received = now();
    await repo.putDoc('pos', p);
    await post(repo, moves);
    // Lots after the posting, so the purchase itself never takes from them.
    if (lots.length) await repo.putDocs('lots', lots);
    if (trip) await repo.putDoc('trips', { ...trip, poId: p.id });
    emit('pos', {}, p.id);
    if (costChanged.size) emit('items');
    res.json({ ok: true });
  }),
);

/** The landmark and a second address line: stock's own additions to billing's customer. */
actionRoutes.post(
  '/admin/customers/:id',
  admin,
  handler(async (req, res) => {
    const body = z.object({ landmark: z.string().trim().max(120).optional(), address: z.string().trim().max(200).optional() }).parse(req.body);
    const repo = getRepo();
    const c = await repo.getDoc<CustomerProfile>('customers', String(req.params.id));
    if (!c) throw new HttpError(404, 'No such customer');
    if (body.landmark != null) c.landmark = body.landmark;
    const moved = !!body.address && body.address !== c.address;
    if (body.address) c.address = body.address;
    await repo.putDoc('customers', c);
    // A customer from billing gets the new address there too, in the background.
    if (moved && c.billingId) void pushAddress(c.billingId, c.address!);
    res.json(c);
  }),
);
