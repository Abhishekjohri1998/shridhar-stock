import { Router } from 'express';
import { z } from 'zod';
import {
  proposeRefill,
  type BillMirror,
  type CustomerProfile,
  type Delivery,
  type Item,
  type OrderRequest,
  type PurchaseOrder,
  type Supplier,
  type Transfer,
} from '@stock/core';
import { requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';

/**
 * What each role reads, and the small things each may do.
 *
 * Every answer is built for its role here, never a full record with fields taken off afterwards:
 * a vendor's purchase order is assembled without sale prices, a customer's catalogue without cost
 * or quantities. Which records a person may see is decided from who they are on the server, never
 * from anything the page sends.
 */
export const roleRoutes = Router();

const admin = requireRole('admin');
const adminOrOwner = requireRole('admin', 'owner');

/** A shop day starts at midnight in India. */
export function istToday(now = Date.now()): string {
  const d = new Date(now + 5.5 * 3600_000);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 5.5 * 3600_000).toISOString();
}

const byNoDesc = <T extends { no: number }>(a: T, b: T) => b.no - a.no;

// ---------------------------------------------------------------- admin

roleRoutes.get(
  '/admin/summary',
  adminOrOwner,
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, stock, locs, bills, transfers, pos, deliveries, orders, meta] = await Promise.all([
      repo.listItems(),
      repo.listStock(),
      repo.listLocations(),
      repo.listDocs<BillMirror>('bills'),
      repo.listDocs<Transfer>('transfers'),
      repo.listDocs<PurchaseOrder>('pos'),
      repo.listDocs<Delivery>('deliveries'),
      repo.listDocs<OrderRequest>('orders'),
      repo.getDoc<{ id: string; link?: unknown; reader?: unknown }>('meta', 'status'),
    ]);
    const shop = locs.find((l) => l.kind === 'shop');
    const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
    const low = shop ? items.filter((i) => i.active && i.reorderAt[shop.id] != null && (qty.get(i.id + '|' + shop.id) ?? 0) < i.reorderAt[shop.id]!).length : 0;
    const today = istToday();
    const todays = bills.filter((b) => b.at >= today && !b.cancelled);
    const lines = bills.flatMap((b) => (b.cancelled ? [] : b.lines));
    const written = lines.filter((l) => l.ink);
    res.json({
      toConfirm: lines.filter((l) => l.state === 'to-confirm').length,
      low,
      negative: new Set(stock.filter((s) => s.qty < 0).map((s) => s.itemId)).size,
      inTransit: transfers.filter((t) => t.status === 'sent').length,
      requested: transfers.filter((t) => t.status === 'requested').length,
      openPos: pos.filter((p) => p.status !== 'received' && p.status !== 'cancelled').length,
      deliveriesToday: deliveries.filter((d) => d.at >= today).length,
      deliveriesPending: deliveries.filter((d) => d.status === 'pending' || d.status === 'out').length,
      newOrders: orders.filter((o) => o.status === 'new').length,
      salesToday: todays.reduce((s, b) => s + b.total, 0),
      billsToday: todays.length,
      due: bills.filter((b) => !b.cancelled).reduce((s, b) => s + Math.max(0, b.balance), 0),
      stockValue: items.reduce((sum, i) => {
        const cost = i.units[0]?.cost ?? 0;
        return sum + cost * stock.filter((s) => s.itemId === i.id).reduce((a, s) => a + Math.max(0, s.qty), 0);
      }, 0),
      handwrittenLines: written.length,
      autoRead: written.filter((l) => l.state === 'read-auto').length,
      link: meta?.link ?? null,
      reader: meta?.reader ?? null,
    });
  }),
);

roleRoutes.get(
  '/admin/bills',
  adminOrOwner,
  handler(async (req, res) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const bills = (await getRepo().listDocs<BillMirror>('bills')).sort(byNoDesc).slice(0, limit);
    res.json(bills);
  }),
);

/** Every handwritten or unmatched line waiting for a person, oldest first. */
roleRoutes.get(
  '/admin/confirm',
  admin,
  handler(async (_req, res) => {
    const bills = (await getRepo().listDocs<BillMirror>('bills')).filter((b) => !b.cancelled).sort((a, b) => a.no - b.no);
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

for (const [path, col] of [
  ['/admin/transfers', 'transfers'],
  ['/admin/pos', 'pos'],
  ['/admin/suppliers', 'suppliers'],
  ['/admin/deliveries', 'deliveries'],
  ['/admin/orders', 'orders'],
  ['/admin/customers', 'customers'],
] as const) {
  roleRoutes.get(
    path,
    adminOrOwner,
    handler(async (_req, res) => {
      const docs = await getRepo().listDocs<{ id: string; no?: number; at?: string }>(col);
      docs.sort((a, b) => (b.no ?? 0) - (a.no ?? 0) || String(b.at ?? '').localeCompare(String(a.at ?? '')));
      res.json(docs);
    }),
  );
}

// ---------------------------------------------------------------- shop worker

/** Today's bills, newest first, each line with where it is kept in the shop. */
roleRoutes.get(
  '/worker/bills',
  requireRole('worker', 'admin', 'owner'),
  handler(async (_req, res) => {
    const repo = getRepo();
    const [bills, items, locs] = await Promise.all([repo.listDocs<BillMirror>('bills'), repo.listItems(), repo.listLocations()]);
    const shop = locs.find((l) => l.kind === 'shop');
    const byId = new Map(items.map((i) => [i.id, i]));
    const today = istToday();
    res.json(
      bills
        .filter((b) => b.at >= today && !b.cancelled)
        .sort(byNoDesc)
        .map((b) => ({
          no: b.no,
          at: b.at,
          customer: b.customer?.name ?? '',
          lines: b.lines.map((l) => {
            // Until a person confirms it, the reader's best guess says which rack to walk to.
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
              rack: item && shop ? item.racks[shop.id] ?? '' : '',
              fetched: !!l.fetched,
            };
          }),
        })),
    );
  }),
);

roleRoutes.post(
  '/worker/bills/:no/lines/:i/fetched',
  requireRole('worker', 'admin'),
  handler(async (req, res) => {
    const { fetched } = z.object({ fetched: z.boolean() }).parse(req.body);
    const repo = getRepo();
    const bill = await repo.getDoc<BillMirror>('bills', String(req.params.no));
    if (!bill) throw new HttpError(404, 'No such bill');
    const line = bill.lines.find((l) => l.i === Number(req.params.i));
    if (!line) throw new HttpError(404, 'No such line');
    line.fetched = fetched;
    await repo.putDoc('bills', bill);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- godown

function myGodown(req: import('express').Request): string {
  const id = req.person!.linkedId;
  if (!id) throw new HttpError(403, 'You are not linked to a godown yet. Ask the admin.');
  return id;
}

roleRoutes.get(
  '/godown/transfers',
  requireRole('godown'),
  handler(async (req, res) => {
    const g = myGodown(req);
    const all = await getRepo().listDocs<Transfer>('transfers');
    res.json(all.filter((t) => t.from === g || t.to === g).sort(byNoDesc));
  }),
);

roleRoutes.get(
  '/godown/stock',
  requireRole('godown'),
  handler(async (req, res) => {
    const g = myGodown(req);
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
  requireRole('godown'),
  handler(async (req, res) => {
    const g = myGodown(req);
    const items = await getRepo().listItems();
    res.json(items.map((i) => ({ id: i.id, nameEn: i.nameEn, nameKn: i.nameKn, units: i.units.map((u) => ({ code: u.code, label: u.label, labelKn: u.labelKn, perBase: u.perBase, price: 0 })), rack: i.racks[g] ?? '' })));
  }),
);

// ---------------------------------------------------------------- vendor

function mySupplier(req: import('express').Request): string {
  const id = req.person!.linkedId;
  if (!id) throw new HttpError(403, 'You are not linked to a supplier yet. Ask the admin.');
  return id;
}

/** A vendor's own orders, with item names and the agreed cost only. */
roleRoutes.get(
  '/vendor/pos',
  requireRole('vendor'),
  handler(async (req, res) => {
    const s = mySupplier(req);
    const repo = getRepo();
    const [pos, items, locs, supplier] = await Promise.all([
      repo.listDocs<PurchaseOrder>('pos'),
      repo.listItems(),
      repo.listLocations(),
      repo.getDoc<Supplier>('suppliers', s),
    ]);
    const byId = new Map(items.map((i) => [i.id, i]));
    res.json({
      supplier: supplier ? { name: supplier.name } : null,
      orders: pos
        .filter((p) => p.supplierId === s)
        .sort(byNoDesc)
        .map((p) => ({
          id: p.id,
          no: p.no,
          status: p.status,
          at: p.at,
          times: p.times,
          to: locs.find((l) => l.id === p.to)?.name ?? '',
          invoiceNo: p.invoiceNo,
          vehicle: p.vehicle,
          eta: p.eta,
          lines: p.lines.map((l) => {
            const it = byId.get(l.itemId);
            return { name: it ? it.nameEn || it.nameKn : l.itemId, nameKn: it?.nameKn ?? '', unit: l.unit, qty: l.qty, cost: l.cost };
          }),
          total: p.lines.reduce((sum, l) => sum + l.qty * l.cost, 0),
        })),
    });
  }),
);

// ---------------------------------------------------------------- delivery

roleRoutes.get(
  '/delivery/mine',
  requireRole('delivery'),
  handler(async (req, res) => {
    const repo = getRepo();
    const [all, bills, items] = await Promise.all([repo.listDocs<Delivery>('deliveries'), repo.listDocs<BillMirror>('bills'), repo.listItems()]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const mine = all.filter((d) => d.personId === req.person!.id).sort((a, b) => a.at.localeCompare(b.at));
    res.json(
      mine.map((d) => {
        const bill = bills.find((b) => b.no === d.billNo);
        return {
          ...d,
          lines: (bill?.lines ?? []).map((l) => {
            const it = l.itemId ? byId.get(l.itemId) : undefined;
            return { text: l.name || l.reading?.readText || (it ? it.nameKn || it.nameEn : ''), ink: l.name ? undefined : l.ink, qty: l.qty };
          }),
        };
      }),
    );
  }),
);

// ---------------------------------------------------------------- customer

function myKey(req: import('express').Request): string {
  return req.person!.phone;
}

roleRoutes.get(
  '/customer/bills',
  requireRole('customer'),
  handler(async (req, res) => {
    const key = myKey(req);
    const [bills, profile] = await Promise.all([
      getRepo().listDocs<BillMirror>('bills'),
      getRepo().listDocs<CustomerProfile>('customers').then((c) => c.find((x) => x.key === key)),
    ]);
    const mine = bills.filter((b) => b.customer?.key === key).sort(byNoDesc);
    res.json({
      name: profile?.name ?? req.person!.name,
      balance: profile?.balance ?? mine.filter((b) => !b.cancelled).reduce((s, b) => s + b.balance, 0),
      bills: mine.map((b) => ({
        no: b.no,
        at: b.at,
        total: b.total,
        paid: b.paid,
        balance: b.balance,
        cancelled: !!b.cancelled,
        lines: b.lines.map((l) => ({ name: l.name, ink: l.ink, qty: l.qty, amount: l.amount })),
      })),
    });
  }),
);

/** What the shop sells: names, units, prices, and whether it is in the shop. No costs, no counts. */
roleRoutes.get(
  '/customer/catalogue',
  requireRole('customer'),
  handler(async (_req, res) => {
    const repo = getRepo();
    const [items, stock, locs] = await Promise.all([repo.listItems(), repo.listStock(), repo.listLocations()]);
    const shop = locs.find((l) => l.kind === 'shop');
    const inShop = new Map(stock.filter((s) => s.locationId === shop?.id).map((s) => [s.itemId, s.qty]));
    res.json(
      items
        .filter((i: Item) => i.active)
        .map((i) => ({
          id: i.id,
          nameEn: i.nameEn,
          nameKn: i.nameKn,
          category: i.category ?? '',
          units: i.units.map((u) => ({ code: u.code, label: u.label, labelKn: u.labelKn, price: u.price })),
          available: (inShop.get(i.id) ?? 0) > 0,
        })),
    );
  }),
);

roleRoutes.get(
  '/customer/orders',
  requireRole('customer'),
  handler(async (req, res) => {
    const all = await getRepo().listDocs<OrderRequest>('orders');
    res.json(all.filter((o) => o.personId === req.person!.id).sort((a, b) => b.at.localeCompare(a.at)));
  }),
);
