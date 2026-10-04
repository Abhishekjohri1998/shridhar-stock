import { Router } from 'express';
import { z } from 'zod';
import {
  findUnit,
  searchKey,
  toBase,
  type BillMirror,
  type Delivery,
  type Ink,
  type OrderRequest,
  type PurchaseOrder,
  type StockMove,
  type Supplier,
  type CustomerProfile,
  type Transfer,
} from '@stock/core';
import { requireRole } from '../auth';
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

/**
 * A person says what a bill line was. The sale moves stock, and what the handwriting was read as
 * becomes another name for the item, so the same writing is recognised next time.
 */
actionRoutes.post(
  '/admin/confirm',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({
        billNo: z.number().int().positive(),
        i: z.number().int().min(0),
        itemId: z.string().optional(),
        unit: z.string().optional(),
        qty: z.number().positive().max(100000).optional(),
        notItem: z.boolean().optional(),
        learn: z.boolean().default(true),
      })
      .parse(req.body);
    const repo = getRepo();
    const bill = await repo.getDoc<BillMirror>('bills', String(body.billNo));
    if (!bill) throw new HttpError(404, 'No such bill');
    const line = bill.lines.find((l) => l.i === body.i);
    if (!line) throw new HttpError(404, 'No such line');
    if (line.state !== 'to-confirm') throw new HttpError(409, 'This line is already done');

    if (body.notItem) {
      line.state = 'not-item';
      await repo.putDoc('bills', bill);
      emit('bills');
      res.json({ ok: true });
      return;
    }
    if (!body.itemId || !body.unit || !body.qty) throw new HttpError(400, 'Choose the item, unit and quantity');
    const item = await repo.getItem(body.itemId);
    if (!item) throw new HttpError(404, 'No such item');
    if (!findUnit(item, body.unit)) throw new HttpError(400, 'That item has no unit "' + body.unit + '"');
    const baseQty = toBase(item, body.unit, body.qty);
    const shop = (await repo.listLocations()).find((l) => l.kind === 'shop')!;

    line.state = 'confirmed';
    line.itemId = item.id;
    line.unit = body.unit;
    line.baseQty = baseQty;
    if (line.reading) line.reading = { ...line.reading, by: req.person!.id, at: now() };
    await repo.putDoc('bills', bill);
    await post(repo, [
      { id: newId('mv'), key: 'sale:' + bill.no + ':' + line.i, at: now(), kind: line.ink ? 'digitise' : 'sale', itemId: item.id, from: shop.id, qty: baseQty, ref: 'bill ' + bill.no + ' line ' + (line.i + 1), by: req.person!.id },
    ]);

    // Learn the name it was written or typed as.
    const said = (line.reading?.readText || line.name || '').replace(/^\s*[\d.]+\s*(kg|g|l|pc|pack|line|box)?\s*/i, '').trim();
    let learnt = '';
    if (body.learn && said && said.length <= 60) {
      const key = searchKey(said);
      const known = [item.nameEn, item.nameKn, ...item.aliases.map((a) => a.text)].some((t) => searchKey(t) === key);
      if (!known && item.aliases.length < 20) {
        item.aliases.push({ text: said, unit: body.unit === item.units[0]!.code ? undefined : body.unit });
        item.aliases = item.aliases.map((a) => (a.unit ? a : { text: a.text }));
        item.updatedAt = now();
        await repo.saveItem(item);
        learnt = said;
      }
    }
    emit('bills');
    if (learnt) emit('items');
    res.json({ ok: true, learnt });
  }),
);

// ---------------------------------------------------------------- the billing link

actionRoutes.post(
  '/admin/link/sync',
  admin,
  handler(async (_req, res) => {
    const { linkConfigured, syncNow } = await import('../billing/link');
    if (!linkConfigured()) throw new HttpError(400, 'The link to billing is not set up (BILLING_URL and BILLING_PIN on the server)');
    const r = await syncNow();
    if (!r) throw new HttpError(502, 'Could not read from billing. See the link status.');
    res.json(r);
  }),
);

actionRoutes.post(
  '/admin/reader/run',
  admin,
  handler(async (_req, res) => {
    const { pickReader, readPending } = await import('../reader');
    res.json(await readPending(getRepo(), pickReader().fn));
  }),
);

/** Writing done on this website, read into an item: "write instead of type". */
const readsByPerson = new Map<string, number[]>();
const READS_PER_HOUR = 60;

actionRoutes.post(
  '/read',
  requireRole('admin', 'godown', 'customer'),
  handler(async (req, res) => {
    const { ink } = z.object({ ink: inkBody.unwrap() }).parse(req.body);
    const { pickReader } = await import('../reader');
    const reader = pickReader();
    if (!reader.fn) throw new HttpError(503, 'Handwriting reading is not switched on. Type the name instead.');
    const now = Date.now();
    const recent = (readsByPerson.get(req.person!.id) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= READS_PER_HOUR) throw new HttpError(429, 'Too many readings this hour. Type the name instead.');
    readsByPerson.set(req.person!.id, [...recent, now]);
    const items = (await getRepo().listItems()).filter((i) => i.active);
    const r = await reader.fn(ink as Ink, { items, qty: 1, rate: 0, examples: '' });
    if (!r.reading) throw new HttpError(422, 'Could not read that. Try writing it again, larger.');
    const known = new Set(items.map((i) => i.id));
    res.json({
      readText: r.reading.readText,
      matches: [
        ...(r.reading.itemId && known.has(r.reading.itemId) ? [{ itemId: r.reading.itemId, confidence: r.reading.confidence }] : []),
        ...r.reading.alternatives.filter((a) => known.has(a.itemId)),
      ].slice(0, 4),
      unit: r.reading.unit,
      qty: r.reading.qty,
    });
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

/** Who may act on a transfer: the admin, or the godown it leaves from / arrives at. */
function mayAct(req: import('express').Request, place: string) {
  const p = req.person!;
  if (p.role === 'admin') return;
  if (p.role === 'godown' && p.linkedId === place) return;
  throw new HttpError(403, 'This transfer is not for your godown');
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
  requireRole('admin', 'godown'),
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
    const moves: StockMove[] = t.lines.map((l) => ({ id: newId('mv'), key: 'xfer:' + t.no + ':out:' + l.itemId, at: now(), kind: 'transfer_out', itemId: l.itemId, from: t.from, qty: l.sent ?? 0, ref: 'transfer ' + t.no, by: req.person!.id }));
    await getRepo().putDoc('transfers', t);
    await post(getRepo(), moves);
    emit('transfers', { locationIds: [t.from, t.to] }, t.id);
    res.json(t);
  }),
);

actionRoutes.post(
  '/transfers/:id/receive',
  requireRole('admin', 'godown'),
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
    const moves: StockMove[] = t.lines.map((l) => ({ id: newId('mv'), key: 'xfer:' + t.no + ':in:' + l.itemId, at: now(), kind: 'transfer_in', itemId: l.itemId, to: t.to, qty: l.received ?? 0, ref: 'transfer ' + t.no, by: req.person!.id, ...((l.received ?? 0) < (l.sent ?? 0) ? { note: (l.sent! - l.received!) + ' short' } : {}) }));
    await getRepo().putDoc('transfers', t);
    await post(getRepo(), moves);
    emit('transfers', { locationIds: [t.from, t.to] }, t.id);
    res.json(t);
  }),
);

// ---------------------------------------------------------------- suppliers

const supplierBody = z.object({
  name: z.string().trim().min(1, 'Give the supplier a name').max(80),
  phone: z.string().trim().max(20).default(''),
  address: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
});

actionRoutes.post(
  '/admin/suppliers',
  admin,
  handler(async (req, res) => {
    const b = supplierBody.parse(req.body);
    const s: Supplier = { id: newId('sup'), name: b.name, phone: b.phone, ...(b.address ? { address: b.address } : {}), active: true };
    await getRepo().putDoc('suppliers', s);
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
    const s: Supplier = { ...old, name: b.name, phone: b.phone, ...(b.address != null ? { address: b.address } : {}), active: b.active ?? old.active };
    await repo.putDoc('suppliers', s);
    res.json(s);
  }),
);

// ---------------------------------------------------------------- purchase orders

actionRoutes.post(
  '/admin/pos',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({ supplierId: z.string(), to: z.string(), lines: z.array(z.object({ itemId: z.string(), unit: z.string(), qty: z.number().positive(), cost: z.number().min(0) })).min(1).max(100) })
      .parse(req.body);
    const repo = getRepo();
    const sup = await repo.getDoc<Supplier>('suppliers', body.supplierId);
    if (!sup || !sup.active) throw new HttpError(404, 'No such supplier');
    if (!(await repo.listLocations()).some((l) => l.id === body.to && l.active)) throw new HttpError(400, 'Choose where the goods go');
    for (const l of body.lines) {
      const item = await repo.getItem(l.itemId);
      if (!item) throw new HttpError(400, 'An item on this order does not exist');
      if (!findUnit(item, l.unit)) throw new HttpError(400, item.nameEn + ' has no unit "' + l.unit + '"');
    }
    const no = await repo.nextNo('po');
    const p: PurchaseOrder = { id: 'po_' + no, no, supplierId: body.supplierId, to: body.to, lines: body.lines, status: 'ordered', at: now(), times: { ordered: now() } };
    await repo.putDoc('pos', p);
    emit('pos', { supplierId: p.supplierId }, p.id);
    res.status(201).json(p);
  }),
);

async function loadPo(req: import('express').Request): Promise<PurchaseOrder> {
  const p = await getRepo().getDoc<PurchaseOrder>('pos', String(req.params.id));
  if (!p) throw new HttpError(404, 'No such order');
  const me = req.person!;
  if (me.role === 'vendor' && me.linkedId !== p.supplierId) throw new HttpError(403, 'This order is not yours');
  return p;
}

actionRoutes.post(
  '/pos/:id/confirm',
  requireRole('vendor', 'admin'),
  handler(async (req, res) => {
    const p = await loadPo(req);
    if (p.status !== 'ordered') throw new HttpError(409, 'Already ' + p.status);
    p.status = 'confirmed';
    p.times.confirmed = now();
    await getRepo().putDoc('pos', p);
    emit('pos', { supplierId: p.supplierId }, p.id);
    res.json({ ok: true });
  }),
);

actionRoutes.post(
  '/pos/:id/dispatch',
  requireRole('vendor', 'admin'),
  handler(async (req, res) => {
    const body = z.object({ invoiceNo: z.string().max(40).optional(), vehicle: z.string().max(40).optional(), eta: z.string().max(40).optional() }).parse(req.body);
    const p = await loadPo(req);
    if (p.status !== 'confirmed' && p.status !== 'ordered') throw new HttpError(409, 'Already ' + p.status);
    p.status = 'dispatched';
    p.times.dispatched = now();
    Object.assign(p, body);
    await getRepo().putDoc('pos', p);
    emit('pos', { supplierId: p.supplierId }, p.id);
    res.json({ ok: true });
  }),
);

actionRoutes.post(
  '/admin/pos/:id/cancel',
  admin,
  handler(async (req, res) => {
    const p = await loadPo(req);
    if (p.status !== 'ordered' && p.status !== 'confirmed') throw new HttpError(409, p.status === 'dispatched' ? 'Already dispatched: receive it, with what arrives' : 'Already ' + p.status);
    p.status = 'cancelled';
    p.times.cancelled = now();
    await getRepo().putDoc('pos', p);
    emit('pos', { supplierId: p.supplierId }, p.id);
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
        updateCost: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const p = await loadPo(req);
    if (p.status === 'received' || p.status === 'cancelled') throw new HttpError(409, 'Already ' + p.status);
    const repo = getRepo();
    const moves: StockMove[] = [];
    const received: { itemId: string; qty: number; cost: number }[] = [];
    for (const l of p.lines) {
      const g = body.got?.[l.itemId];
      const qty = g?.qty ?? l.qty;
      const cost = g?.cost ?? l.cost;
      if (qty > l.qty) throw new HttpError(400, 'More received than ordered: count again, or order the rest separately.');
      received.push({ itemId: l.itemId, qty, cost });
      const item = await repo.getItem(l.itemId);
      if (!item || qty === 0) continue;
      moves.push({ id: newId('mv'), key: 'po:' + p.no + ':' + l.itemId, at: now(), kind: 'purchase', itemId: l.itemId, to: p.to, qty: toBase(item, l.unit, qty), ref: 'order ' + p.no, by: req.person!.id, ...(qty < l.qty ? { note: l.qty - qty + ' ' + l.unit + ' short' } : {}) });
      // The price paid becomes the item's cost for that unit, when the admin says so.
      if (body.updateCost) {
        const u = item.units.find((x) => x.code === l.unit);
        if (u && u.cost !== cost) {
          u.cost = cost;
          item.updatedAt = now();
          await repo.saveItem(item);
        }
      }
    }
    (p as PurchaseOrder & { received?: typeof received }).received = received;
    p.status = 'received';
    p.times.received = now();
    await repo.putDoc('pos', p);
    await post(repo, moves);
    emit('pos', { supplierId: p.supplierId }, p.id);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- deliveries

async function deliveryPerson(id: string) {
  const p = await getRepo().getPerson(id);
  if (!p || !p.active || p.role !== 'delivery') throw new HttpError(400, 'Choose a delivery person');
  return p;
}

/**
 * A bill goes out for delivery. Where to and who to call come from the customer billing knows,
 * with the landmark stock keeps; what to collect is what is still due on the bill.
 */
actionRoutes.post(
  '/admin/deliveries',
  admin,
  handler(async (req, res) => {
    const body = z
      .object({
        billNo: z.number().int().positive(),
        personId: z.string(),
        vehicle: z.string().trim().max(40).optional(),
        note: z.string().trim().max(200).optional(),
        address: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    const repo = getRepo();
    const bill = await repo.getDoc<BillMirror>('bills', String(body.billNo));
    if (!bill) throw new HttpError(404, 'No such bill');
    if (bill.cancelled) throw new HttpError(400, 'This bill was cancelled');
    await deliveryPerson(body.personId);
    const open = (await repo.listDocs<Delivery>('deliveries')).find((d) => d.billNo === bill.no && d.status !== 'delivered');
    if (open) throw new HttpError(409, 'This bill is already out for delivery. Change who takes it instead.');
    const customer = bill.customer ? (await repo.listDocs<CustomerProfile>('customers')).find((c) => c.key === bill.customer!.key) : undefined;
    const address = body.address || customer?.address || '';
    if (!address) throw new HttpError(400, 'Where to? This customer has no address: type one');
    const d: Delivery = {
      id: newId('dl'),
      billNo: bill.no,
      customerKey: bill.customer?.key ?? '',
      name: customer?.name ?? bill.customer?.name ?? 'Customer',
      phone: bill.customer?.phone ?? '',
      address,
      ...(customer?.landmark ? { landmark: customer.landmark } : {}),
      personId: body.personId,
      ...(body.vehicle ? { vehicle: body.vehicle } : {}),
      status: 'pending',
      amountDue: Math.max(0, bill.balance),
      ...(body.note ? { note: body.note } : {}),
      at: now(),
      times: { pending: now() },
    };
    await repo.putDoc('deliveries', d);
    emit('deliveries', { personId: d.personId! }, d.id);
    res.status(201).json(d);
  }),
);

/** Someone else takes it: both the old and the new person's screens update. */
actionRoutes.post(
  '/admin/deliveries/:id/assign',
  admin,
  handler(async (req, res) => {
    const body = z.object({ personId: z.string(), vehicle: z.string().trim().max(40).optional() }).parse(req.body);
    const repo = getRepo();
    const d = await repo.getDoc<Delivery>('deliveries', String(req.params.id));
    if (!d) throw new HttpError(404, 'No such delivery');
    if (d.status === 'delivered') throw new HttpError(409, 'Already delivered');
    await deliveryPerson(body.personId);
    const before = d.personId;
    d.personId = body.personId;
    if (body.vehicle) d.vehicle = body.vehicle;
    if (d.status === 'out' || d.status === 'failed') {
      d.status = 'pending';
      d.times.pending = now();
    }
    await repo.putDoc('deliveries', d);
    emit('deliveries', { personId: body.personId }, d.id);
    if (before && before !== body.personId) emit('deliveries', { personId: before }, d.id);
    res.json(d);
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


actionRoutes.post(
  '/deliveries/:id/status',
  requireRole('delivery', 'admin'),
  handler(async (req, res) => {
    const body = z.object({ status: z.enum(['out', 'delivered', 'failed']), note: z.string().max(200).optional() }).parse(req.body);
    const repo = getRepo();
    const d = await repo.getDoc<Delivery>('deliveries', String(req.params.id));
    if (!d) throw new HttpError(404, 'No such delivery');
    if (req.person!.role === 'delivery' && d.personId !== req.person!.id) throw new HttpError(403, 'This delivery is not yours');
    const allowed: Record<string, string[]> = { pending: ['out'], out: ['delivered', 'failed'], failed: ['out'] };
    if (!(allowed[d.status] ?? []).includes(body.status)) throw new HttpError(409, 'Cannot go from ' + d.status + ' to ' + body.status);
    d.status = body.status;
    d.times[body.status] = now();
    if (body.note) d.note = body.note;
    await repo.putDoc('deliveries', d);
    emit('deliveries', { personId: d.personId ?? '' }, d.id);
    res.json(d);
  }),
);

// ---------------------------------------------------------------- customer order requests

actionRoutes.post(
  '/customer/orders',
  requireRole('customer'),
  handler(async (req, res) => {
    const body = z
      .object({
        note: z.string().max(300).optional(),
        lines: z.array(z.object({ itemId: z.string().optional(), unit: z.string().max(16).optional(), qty: z.number().positive().max(10000).optional(), text: z.string().max(80).optional(), ink: inkBody })).min(1).max(40),
      })
      .parse(req.body);
    const o: OrderRequest = {
      id: newId('or'),
      personId: req.person!.id,
      customerKey: req.person!.phone,
      lines: body.lines.map((l) => ({ ...l, ...(l.ink ? { ink: l.ink as Ink } : {}) })),
      status: 'new',
      at: now(),
      ...(body.note ? { note: body.note } : {}),
    };
    await getRepo().putDoc('orders', o);
    emit('orders', { customerKey: o.customerKey }, o.id);
    res.status(201).json(o);
  }),
);

actionRoutes.post(
  '/admin/orders/:id',
  admin,
  handler(async (req, res) => {
    const body = z.object({ status: z.enum(['done', 'declined']), billNo: z.number().int().positive().optional() }).parse(req.body);
    const repo = getRepo();
    const o = await repo.getDoc<OrderRequest>('orders', String(req.params.id));
    if (!o) throw new HttpError(404, 'No such request');
    o.status = body.status;
    if (body.billNo) o.billNo = body.billNo;
    await repo.putDoc('orders', o);
    emit('orders', { customerKey: o.customerKey }, o.id);
    res.json(o);
  }),
);
