import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  findUnit,
  hasInk,
  type Ink,
  isActiveRole,
  itemMatches,
  matchedAliasUnit,
  normalisePhone,
  priceFor,
  rateRange,
  retiredRoleMessage,
  sellUnitOf,
  unitsSellFirst,
  unitRate1,
} from '@stock/core';
import { issueToken, publicPerson } from '../auth';
import { verifyPin } from '../pin';
import { lockedFor, recordFailure, recordSuccess } from '../ratelimit';
import { env } from '../env';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';
import { settingsOf } from '../setup';
import { putDraft } from '../billing/drafts';

/**
 * What the billing server asks stock while a bill is written: items as the counter types, the
 * rate for a quantity, the round-off step, and the live draft for the worker's screen.
 *
 * Billing's server calls this, never a browser, with the shared LINK_KEY in X-Link-Key. With no
 * key set here the whole door answers 404, as if it were not there.
 */
export const billingLinkRoutes = Router();

const digest = (s: string) => createHash('sha256').update(s).digest();

billingLinkRoutes.use((req: Request, res: Response, next: NextFunction) => {
  if (!env.linkKey) {
    res.status(404).json({ error: 'No such address' });
    return;
  }
  // Compared as fixed-length hashes, in constant time, so the answer's timing says nothing.
  if (!timingSafeEqual(digest(String(req.get('x-link-key') ?? '')), digest(env.linkKey))) {
    res.status(401).json({ error: 'Wrong link key' });
    return;
  }
  next();
});

billingLinkRoutes.get(
  '/items',
  handler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
    const items = q ? (await getRepo().listItems()).filter((i) => i.active && itemMatches(i, q)).slice(0, limit) : [];
    res.json({
      items: items.map((i) => {
        // Typed through an other name tied to a unit ("HG box" -> Box): billing picks that unit.
        const au = matchedAliasUnit(i, q);
        const matchedUnit = au ? findUnit(i, au)?.code : undefined;
        return {
        id: i.id,
        nameEn: i.nameEn,
        nameKn: i.nameKn,
        // The base rate before slabs; cost never leaves stock.
        // The unit it is sold in first (else the default unit), so billing's chips lead with it.
        sellUnit: sellUnitOf(i).code,
        units: unitsSellFirst(i).map((u) => ({
          code: u.code,
          label: u.label,
          labelKn: u.labelKn,
          // The rate for one of this unit: a slab that starts at 1 sets it, else the unit's price.
          price: unitRate1(u),
          ...(u.slabs?.length ? { basePrice: u.price, slabs: u.slabs.map((x) => ({ minQty: x.minQty, rate: x.rate })) } : {}),
          ...(u.min != null ? { min: u.min } : {}),
          ...(u.max != null ? { max: u.max } : {}),
        })),
        ...(matchedUnit ? { matchedUnit } : {}),
        };
      }),
    });
  }),
);

billingLinkRoutes.get(
  '/quote',
  handler(async (req, res) => {
    const qty = Number(req.query.qty);
    if (!(qty > 0)) throw new HttpError(400, 'qty must be more than 0');
    const item = (await getRepo().listItems()).find((i) => i.id === String(req.query.item ?? ''));
    const unit = item && findUnit(item, String(req.query.unit ?? ''));
    if (!item || !unit) throw new HttpError(404, 'No such item or unit');
    const p = priceFor(item, unit.code, qty);
    const range = rateRange(unit, p.rate);
    res.json({ rate: p.rate, amount: p.amount, unit: p.unit, slab: !!p.slab, warn: range === 'low' ? 'below' : range === 'high' ? 'above' : null });
  }),
);

billingLinkRoutes.get(
  '/settings',
  handler(async (_req, res) => {
    res.json({ roundTo: (await settingsOf(getRepo())).roundTo });
  }),
);

/** About 40 KB of stroke numbers per draft, and per line a sane shape; more is dropped to "handwritten". */
export const DRAFT_INK_NUMBERS = 8000;
const inkShape = z.object({
  w: z.number().finite().positive().max(10000),
  h: z.number().finite().positive().max(10000),
  strokes: z.array(z.array(z.number().finite()).max(4000)).max(400),
});

/** A draft line's ink: real strokes when they are valid, else only the "it is handwritten" flag. */
function cleanInk(v: unknown): boolean | Ink {
  if (v == null || typeof v === 'boolean') return !!v;
  const p = inkShape.safeParse(v);
  if (!p.success) return true;
  const ink = { w: p.data.w, h: p.data.h, strokes: p.data.strokes.map((s) => s.map((n) => Math.round(n * 10) / 10)) };
  return hasInk(ink) ? ink : true;
}

const draftBody = z.object({
  draftId: z.string().trim().min(1).max(80),
  customerName: z.string().max(120).optional().default(''),
  closed: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        nameEn: z.string().max(200).optional().default(''),
        nameKn: z.string().max(200).optional().default(''),
        qty: z.number().finite(),
        unit: z.string().max(40).optional(),
        rate: z.number().finite(),
        stockItemId: z.string().max(80).optional(),
        given: z.boolean().optional(),
        givenAt: z.number().finite().optional(),
        ink: z.any().optional(),
      }),
    )
    .max(200)
    .default([]),
});

billingLinkRoutes.post(
  '/draft',
  handler(async (req, res) => {
    const body = draftBody.parse(req.body);
    // The writing itself when billing sends it, so the worker sees it as on a saved bill.
    let budget = DRAFT_INK_NUMBERS;
    const lines = body.lines.map((l) => {
      const ink = cleanInk(l.ink);
      if (ink && typeof ink === 'object') {
        const n = ink.strokes.reduce((s, st) => s + st.length, 0);
        // Past the draft's budget the line still shows as handwritten, just without the strokes.
        if (n > budget) return { ...l, ink: true };
        budget -= n;
      }
      return { ...l, ink };
    });
    res.json({ ticks: putDraft({ ...body, lines }) });
  }),
);

const authBody = z.object({ phone: z.string().max(20), pin: z.string().max(12) });

/**
 * Billing's sign-in by person: the phone and PIN of a stock account. Answers the role, the name
 * and a normal stock session, the same one /api/auth/login issues, so the billing app can open
 * the Stock tab already signed in. The login's lock applies too. Every try arrives from billing's
 * one server, so the address part of the lock is the link itself.
 */
billingLinkRoutes.post(
  '/auth',
  handler(async (req, res) => {
    const { phone: rawPhone, pin } = authBody.parse(req.body);
    const phone = normalisePhone(rawPhone);
    const ip = 'billing-link';
    const wait = lockedFor(ip, phone);
    if (wait > 0) throw new HttpError(429, 'Too many wrong PINs. Try again in ' + Math.ceil(wait / 60000) + ' minutes.');
    const p = phone ? await getRepo().findPersonByPhone(phone) : null;
    if (!p || !p.active || !verifyPin(pin, p.pinHash)) {
      recordFailure(ip, phone);
      throw new HttpError(401, 'Wrong phone number or PIN');
    }
    recordSuccess(ip, phone);
    if (!isActiveRole(p.role)) throw new HttpError(403, retiredRoleMessage(p.role));
    res.json({ role: p.role, name: p.name, token: issueToken(p) });
  }),
);

/** Shop-auth hands out an admin session on the key alone, so a burst is capped all the same. */
const SHOP_AUTH_PER_MIN = 30;
let shopAuthWindow = { start: 0, n: 0 };

/**
 * Billing's shop-PIN sign-in: billing has already checked its shop PIN, and asks for a stock
 * session for the shop's admin so the Stock tab opens signed in. The admin is SHOP_ADMIN_PHONE
 * when set, else the oldest active admin. 409 when there is none.
 */
billingLinkRoutes.post(
  '/shop-auth',
  handler(async (_req, res) => {
    const now = Date.now();
    if (now - shopAuthWindow.start > 60000) shopAuthWindow = { start: now, n: 0 };
    if (++shopAuthWindow.n > SHOP_AUTH_PER_MIN) throw new HttpError(429, 'Too many tries. Try again in a minute.');
    const people = await getRepo().listPeople();
    const want = env.shopAdminPhone ? normalisePhone(env.shopAdminPhone) : '';
    const admins = people.filter((p) => p.active && p.role === 'admin' && isActiveRole(p.role));
    const p = want
      ? admins.find((a) => normalisePhone(a.phone) === want)
      : admins.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!p) throw new HttpError(409, want ? 'SHOP_ADMIN_PHONE is not an active admin' : 'Stock has no active admin');
    res.json({ token: issueToken(p), person: publicPerson(p) });
  }),
);
