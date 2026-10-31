import { Router } from 'express';
import { z } from 'zod';
import { unitKey, type Item, type PurchaseOrder } from '@stock/core';
import { audit, requireRole } from '../auth';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';
import { newId } from '../store/types';
import { emit } from '../events';

/**
 * Setup → Units: every unit code the items use, in one place, and a rename that reaches every
 * item at once. Also the held (draft) purchase orders of Purchases → New order.
 */
export const unitRoutes = Router();

const admin = requireRole('admin');
const now = () => new Date().toISOString();

/** One unit code as used across the items. */
export interface UnitUse {
  code: string;
  label: string;
  labelKn: string;
  count: number;
  /** Every item with it: how many base units one is there ("Box = 60 pc"). */
  items: { id: string; nameEn: string; nameKn: string; perBase: number; base: string; active: boolean }[];
  /** Other labels some items give the same code, when they differ. */
  otherLabels: string[];
}

/** The most common value, ties to the first seen. */
function commonest(vals: string[]): string {
  const n = new Map<string, number>();
  for (const v of vals) n.set(v, (n.get(v) ?? 0) + 1);
  let best = '';
  let max = 0;
  for (const [v, c] of n) if (c > max) [best, max] = [v, c];
  return best;
}

export function unitUses(items: Item[]): UnitUse[] {
  const by = new Map<string, { codes: string[]; labels: string[]; kns: string[]; items: UnitUse['items'] }>();
  for (const it of items) {
    for (const u of it.units) {
      const k = unitKey(u.code);
      if (!k) continue;
      const g = by.get(k) ?? { codes: [], labels: [], kns: [], items: [] };
      g.codes.push(u.code.trim());
      g.labels.push(u.label ?? '');
      if (u.labelKn) g.kns.push(u.labelKn);
      g.items.push({ id: it.id, nameEn: it.nameEn, nameKn: it.nameKn, perBase: u.perBase, base: it.units[0]?.label || it.units[0]?.code || '', active: it.active });
      by.set(k, g);
    }
  }
  return [...by.values()]
    .map((g) => {
      const label = commonest(g.labels);
      return {
        code: commonest(g.codes),
        label,
        labelKn: commonest(g.kns),
        count: g.items.length,
        items: g.items.sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
        otherLabels: [...new Set(g.labels)].filter((l) => l !== label),
      };
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

unitRoutes.get(
  '/admin/units',
  admin,
  handler(async (_req, res) => {
    res.json(unitUses(await getRepo().listItems()));
  }),
);

const renameBody = z.object({
  label: z.string().trim().min(1, 'Give the unit a name').max(30).optional(),
  labelKn: z.string().trim().max(30).optional(),
  code: z.string().trim().min(1).max(20).optional(),
  /** Changing the code reaches every item and open order: it needs a yes. */
  confirm: z.boolean().optional(),
});

/**
 * Renames a unit on every item that has it: its label, its Kannada label, or (with `confirm`)
 * its code. A code rename follows the code wherever an item points at it -- the default and
 * selling unit, other names, running-low levels -- and in order lines, so nothing is lost. Sizes,
 * prices, slabs, costs and stock (kept in base units) are untouched. An entry goes in `unitChanges`.
 */
unitRoutes.put(
  '/admin/units/:code',
  admin,
  handler(async (req, res) => {
    const b = renameBody.parse(req.body);
    const from = unitKey(String(req.params.code));
    const repo = getRepo();
    const items = (await repo.listItems()).filter((i) => i.units.some((u) => unitKey(u.code) === from));
    if (!items.length) throw new HttpError(404, 'No item uses that unit');
    const current = items[0]!.units.find((u) => unitKey(u.code) === from)!.code;
    const newCode = b.code != null && b.code.trim() !== current ? b.code.trim() : undefined;
    const to = newCode != null ? unitKey(newCode) : from;
    if (newCode != null && !b.confirm) throw new HttpError(409, 'Changing the code changes ' + items.length + ' items. Confirm to go ahead.');
    if (newCode != null && to !== from) {
      const clash = items.find((i) => i.units.some((u) => unitKey(u.code) === to));
      if (clash) throw new HttpError(409, clash.nameEn + ' already has a unit ' + newCode);
    }
    const at = now();
    const swap = (c: string | undefined) => (c != null && newCode != null && unitKey(c) === from ? newCode : c);
    for (const it of items) {
      it.units = it.units.map((u) =>
        unitKey(u.code) === from ? { ...u, ...(newCode != null ? { code: newCode } : {}), ...(b.label != null ? { label: b.label } : {}), ...(b.labelKn != null ? { labelKn: b.labelKn } : {}) } : u,
      );
      if (newCode != null) {
        if (it.defaultUnit) it.defaultUnit = swap(it.defaultUnit);
        if (it.sellUnit) it.sellUnit = swap(it.sellUnit);
        it.aliases = it.aliases.map((a) => (a.unit ? { ...a, unit: swap(a.unit) } : a));
        if (it.lowAt) it.lowAt = { ...it.lowAt, unit: swap(it.lowAt.unit)! };
        if (it.lowAtPlace) it.lowAtPlace = Object.fromEntries(Object.entries(it.lowAtPlace).map(([k, v]) => [k, { ...v, unit: swap(v.unit)! }]));
      }
      it.updatedAt = at;
      await repo.saveItem(it);
    }
    let orders = 0;
    if (newCode != null) {
      const ids = new Set(items.map((i) => i.id));
      const pos = await repo.listDocs<PurchaseOrder>('pos', { filter: { 'lines.itemId': [...ids] } });
      const changed = pos.filter((p) => p.lines.some((l) => ids.has(l.itemId) && unitKey(l.unit) === from));
      for (const p of changed) p.lines = p.lines.map((l) => (ids.has(l.itemId) && unitKey(l.unit) === from ? { ...l, unit: newCode } : l));
      if (changed.length) await repo.putDocs('pos', changed);
      orders = changed.length;
      const drafts = await repo.listDocs<OrderDraft>('orderDrafts');
      const dChanged = drafts.filter((d) => d.lines.some((l) => ids.has(l.itemId) && unitKey(l.unit) === from));
      for (const d of dChanged) d.lines = d.lines.map((l) => (ids.has(l.itemId) && unitKey(l.unit) === from ? { ...l, unit: newCode } : l));
      if (dChanged.length) await repo.putDocs('orderDrafts', dChanged);
    }
    await repo.putDoc('unitChanges', {
      id: newId('unc'),
      at,
      ...audit(req),
      code: from,
      ...(newCode != null ? { newCode } : {}),
      ...(b.label != null ? { label: b.label } : {}),
      ...(b.labelKn != null ? { labelKn: b.labelKn } : {}),
      items: items.map((i) => i.id),
      orders,
    });
    emit('items');
    if (orders) emit('pos');
    res.json({ ok: true, items: items.length, orders, unit: unitUses(await repo.listItems()).find((u) => unitKey(u.code) === to) });
  }),
);

// ---------------------------------------------------------------- held orders (drafts)

/** A new purchase order still being made: kept on the server until Save order, or discarded. */
export interface OrderDraft {
  id: string;
  supplierId?: string;
  expectedOn?: string;
  notes?: string;
  lines: { itemId: string; unit: string; qty: number | string; cost: number | string }[];
  /** Anything else the form keeps (how it comes, the carrier), as the form had it. */
  extra?: Record<string, unknown>;
  held?: boolean;
  by: string;
  at: string;
  updatedAt: string;
}

const draftBody = z.object({
  supplierId: z.string().max(80).optional(),
  expectedOn: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
  lines: z
    .array(z.object({ itemId: z.string().min(1).max(80), unit: z.string().max(20), qty: z.union([z.number(), z.string().max(20)]), cost: z.union([z.number(), z.string().max(20)]) }))
    .max(300)
    .default([]),
  extra: z.record(z.string(), z.unknown()).optional(),
  held: z.boolean().optional(),
});

unitRoutes.get(
  '/admin/order-drafts',
  admin,
  handler(async (_req, res) => {
    const all = await getRepo().listDocs<OrderDraft>('orderDrafts');
    res.json(all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }),
);

/** Creates or replaces a draft: the form autosaves here a second after each change. */
unitRoutes.put(
  '/admin/order-drafts/:id',
  admin,
  handler(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw new HttpError(400, 'Bad draft id');
    const b = draftBody.parse(req.body ?? {});
    const repo = getRepo();
    const old = await repo.getDoc<OrderDraft>('orderDrafts', id);
    const at = now();
    const d: OrderDraft = {
      id,
      ...(b.supplierId ? { supplierId: b.supplierId } : {}),
      ...(b.expectedOn ? { expectedOn: b.expectedOn } : {}),
      ...(b.notes ? { notes: b.notes } : {}),
      lines: b.lines,
      ...(b.extra ? { extra: b.extra } : {}),
      ...((b.held ?? old?.held) ? { held: true } : {}),
      by: old?.by ?? audit(req).by,
      at: old?.at ?? at,
      updatedAt: at,
    };
    await repo.putDoc('orderDrafts', d);
    res.json(d);
  }),
);

unitRoutes.delete(
  '/admin/order-drafts/:id',
  admin,
  handler(async (req, res) => {
    await getRepo().deleteDoc('orderDrafts', String(req.params.id));
    res.json({ ok: true });
  }),
);
