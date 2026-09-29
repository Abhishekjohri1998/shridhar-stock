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
  type Transfer,
} from '@stock/core';
import { requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { post } from '../posting';
import { getRepo } from '../store';
import { newId } from '../store/types';

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
    res.json({ ok: true, learnt });
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
    if (!locs.some((l) => l.id === body.from) || !locs.some((l) => l.id === body.to) || body.from === body.to) throw new HttpError(400, 'Choose two different places');
    const no = await repo.nextNo('transfer');
    const t: Transfer = { id: 'tr_' + no, no, from: body.from, to: body.to, lines: body.lines, status: 'requested', at: now(), times: { requested: now() }, ...(body.note ? { note: body.note } : {}) };
    await repo.putDoc('transfers', t);
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
  '/transfers/:id/send',
  requireRole('admin', 'godown'),
  handler(async (req, res) => {
    const body = z
      .object({ vehicle: z.string().max(40).optional(), driver: z.string().max(40).optional(), note: z.string().max(200).optional(), noteInk: inkBody, sent: z.record(z.string(), z.number().min(0).max(1e6)).optional() })
      .parse(req.body);
    const t = await loadTransfer(String(req.params.id));
    mayAct(req, t.from);
    if (t.status !== 'requested') throw new HttpError(409, 'Already ' + t.status);
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
    t.lines = t.lines.map((l) => ({ ...l, received: body.received?.[l.itemId] ?? l.sent ?? l.qty }));
    t.status = 'received';
    t.times.received = now();
    if (body.note) t.note = body.note;
    const moves: StockMove[] = t.lines.map((l) => ({ id: newId('mv'), key: 'xfer:' + t.no + ':in:' + l.itemId, at: now(), kind: 'transfer_in', itemId: l.itemId, to: t.to, qty: l.received ?? 0, ref: 'transfer ' + t.no, by: req.person!.id, ...((l.received ?? 0) < (l.sent ?? 0) ? { note: (l.sent! - l.received!) + ' short' } : {}) }));
    await getRepo().putDoc('transfers', t);
    await post(getRepo(), moves);
    res.json(t);
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
    if (!(await repo.getDoc('suppliers', body.supplierId))) throw new HttpError(404, 'No such supplier');
    const no = await repo.nextNo('po');
    const p: PurchaseOrder = { id: 'po_' + no, no, supplierId: body.supplierId, to: body.to, lines: body.lines, status: 'ordered', at: now(), times: { ordered: now() } };
    await repo.putDoc('pos', p);
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
    res.json({ ok: true });
  }),
);

actionRoutes.post(
  '/admin/pos/:id/receive',
  admin,
  handler(async (req, res) => {
    const p = await loadPo(req);
    if (p.status === 'received' || p.status === 'cancelled') throw new HttpError(409, 'Already ' + p.status);
    const repo = getRepo();
    const moves: StockMove[] = [];
    for (const l of p.lines) {
      const item = await repo.getItem(l.itemId);
      if (!item) continue;
      moves.push({ id: newId('mv'), key: 'po:' + p.no + ':' + l.itemId, at: now(), kind: 'purchase', itemId: l.itemId, to: p.to, qty: toBase(item, l.unit, l.qty), ref: 'order ' + p.no, by: req.person!.id });
    }
    p.status = 'received';
    p.times.received = now();
    await repo.putDoc('pos', p);
    await post(repo, moves);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- deliveries

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
    res.json(o);
  }),
);
