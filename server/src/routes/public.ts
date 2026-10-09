import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { deliverySteps, isActiveDelivery, type CustomerProfile, type Delivery } from '@stock/core';
import { emit, onEmit } from '../events';
import { handler, HttpError } from '../http';
import { linkOk, type LinkPurpose } from '../links';
import { roadRouter } from '../route';
import { settingsOf, shopOf } from '../setup';
import { getRepo } from '../store';

/**
 * The customer's two pages, with no sign-in: follow a delivery (/t) and send their own location
 * (/l). Each works only with the delivery's own signed token (see links.ts), and shows only what
 * the customer may see: never the phone numbers, the trail, other deliveries, or the amounts
 * beyond what they have to pay.
 */
export const publicRoutes = Router();

/** A delivered order stays visible this long, so the customer sees "Delivered at 4:32 pm". */
export const TRACK_GRACE_MS = 30 * 60_000;
/** Requests one address may make a minute, across these pages. */
const PER_MINUTE = 120;
/** The most customers' live streams open at once. */
const MAX_STREAMS = 300;

const hits = new Map<string, { n: number; until: number }>();
function limit(req: Request, _res: Response, next: NextFunction): void {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
  const ip = req.ip ?? '';
  let h = hits.get(ip);
  if (!h || h.until < now) {
    h = { n: 0, until: now + 60_000 };
    hits.set(ip, h);
  }
  h.n++;
  if (h.n > PER_MINUTE) return next(new HttpError(429, 'Too many requests. Wait a minute.'));
  next();
}
publicRoutes.use(['/t', '/l'], limit);

const gone = () => new HttpError(404, 'This link has ended');

/** The delivery behind a link, or 404 when the token is wrong or the link has ended. */
async function byLink(id: string, tok: string, purpose: LinkPurpose): Promise<Delivery> {
  if (!linkOk(id, purpose, tok)) throw gone();
  const d = await getRepo().getDoc<Delivery>('deliveries', id);
  if (!d) throw gone();
  if (isActiveDelivery(d.status)) return d;
  // Tracking shows a delivered order for a little while; anything else over is gone.
  const doneAt = d.times.delivered ? Date.parse(d.times.delivered) : 0;
  if (purpose === 'track' && d.status === 'delivered' && Date.now() - doneAt < TRACK_GRACE_MS) return d;
  throw gone();
}

const firstName = (n: string) => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] ?? '';

publicRoutes.get(
  '/t/:id/:tok',
  handler(async (req, res) => {
    const d = await byLink(String(req.params.id), String(req.params.tok), 'track');
    const repo = getRepo();
    const [settings, shop, worker] = await Promise.all([settingsOf(repo), shopOf(repo), d.personId ? repo.getPerson(d.personId) : Promise.resolve(null)]);
    const out = d.status === 'out';
    const home = d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null;
    let route: { lat: number; lng: number }[] = [];
    if (out && d.pos && home) route = (await roadRouter().route({ lat: d.pos.lat, lng: d.pos.lng }, home))?.points ?? [];
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      id: d.id,
      shopName: shop.name,
      shopPhone: settings.shopPhone ?? '',
      shop: settings.shopLat != null && settings.shopLng != null ? { lat: settings.shopLat, lng: settings.shopLng } : null,
      status: d.status,
      steps: deliverySteps(d),
      worker: worker ? firstName(worker.name) : '',
      vehicleKind: d.vehicleKind ?? 'bike',
      home,
      // Where the worker is, only while on the way: never the trail behind them.
      ...(out && d.pos ? { pos: { lat: d.pos.lat, lng: d.pos.lng, at: d.pos.at }, route } : {}),
      ...(out && d.eta ? { eta: { minutes: d.eta.minutes, at: d.eta.at } } : {}),
      ...(isActiveDelivery(d.status) && d.otp && !d.otpSkipped ? { otp: d.otp } : {}),
      ...(isActiveDelivery(d.status) && d.amountDue > 0 ? { toPay: d.amountDue } : {}),
      ...(d.times.delivered ? { deliveredAt: d.times.delivered } : {}),
    });
  }),
);

/** A live stream for one delivery: says only "changed", and the page reads it again. */
let streams = 0;
publicRoutes.get(
  '/t/:id/:tok/events',
  handler(async (req, res) => {
    const d = await byLink(String(req.params.id), String(req.params.tok), 'track');
    if (streams >= MAX_STREAMS) throw new HttpError(503, 'Busy. Try again soon.');
    streams++;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write('event: hello\ndata: {}\n\n');
    const off = onEmit((kind, id) => {
      if (kind !== 'delivery' || id !== d.id) return;
      try {
        res.write('event: change\ndata: {}\n\n');
      } catch {
        /* closed */
      }
    });
    const beat = setInterval(() => {
      try {
        res.write(': beat\n\n');
      } catch {
        /* closed */
      }
    }, 25_000);
    // A stream ends with the link's grace, so a forgotten tab does not stay open for ever.
    const end = setTimeout(() => res.end(), TRACK_GRACE_MS + 6 * 3600_000);
    res.on('close', () => {
      streams--;
      off();
      clearInterval(beat);
      clearTimeout(end);
    });
  }),
);

/** What the "send my location" page shows before the customer taps. */
publicRoutes.get(
  '/l/:id/:tok',
  handler(async (req, res) => {
    const d = await byLink(String(req.params.id), String(req.params.tok), 'locate');
    const shop = await shopOf(getRepo());
    res.setHeader('Cache-Control', 'no-store');
    res.json({ shopName: shop.name, located: !!d.locatedAt });
  }),
);

publicRoutes.post(
  '/l/:id/:tok',
  handler(async (req, res) => {
    const b = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).optional() }).parse(req.body);
    if (b.lat === 0 && b.lng === 0) throw new HttpError(400, 'That is not a place');
    const repo = getRepo();
    const d = await byLink(String(req.params.id), String(req.params.tok), 'locate');
    if (d.status !== 'pending' && d.status !== 'out') throw gone();
    d.lat = b.lat;
    d.lng = b.lng;
    d.locatedAt = new Date().toISOString();
    // The arrival time was worked out for the old pin.
    delete d.eta;
    await repo.putDoc('deliveries', d);
    // Kept on the customer, for next time.
    if (d.customerKey) {
      const c = await repo.getDoc<CustomerProfile>('customers', 'c_' + d.customerKey);
      await repo.putDoc<CustomerProfile>('customers', { ...(c ?? { id: 'c_' + d.customerKey, key: d.customerKey, name: d.name, balance: 0 }), lat: b.lat, lng: b.lng });
    }
    emit('delivery', d.personId ? { personId: d.personId } : { roles: [] }, d.id, { what: 'located' });
    res.json({ ok: true });
  }),
);
