import crypto from 'node:crypto';
import { env } from './env';

/**
 * The customer's links: /t/<id>/<token> to follow a delivery, /l/<id>/<token> to send their own
 * location. The token is an HMAC of the delivery id and the purpose with the server's secret, so
 * nothing needs storing and a link cannot be guessed or turned from one purpose into the other.
 * A link stops working once the delivery is over (the routes check that).
 */
export type LinkPurpose = 'track' | 'locate';

export function linkToken(deliveryId: string, purpose: LinkPurpose): string {
  return crypto.createHmac('sha256', env.jwtSecret).update(deliveryId + '|' + purpose).digest('base64url').slice(0, 16);
}

/** Compares in constant time, so the token cannot be found a character at a time. */
export function linkOk(deliveryId: string, purpose: LinkPurpose, token: string): boolean {
  const want = Buffer.from(linkToken(deliveryId, purpose));
  const got = Buffer.from(String(token ?? ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** The paths (without the site's address) the admin and worker share. */
export const linkPaths = (id: string) => ({ track: '/t/' + id + '/' + linkToken(id, 'track'), locate: '/l/' + id + '/' + linkToken(id, 'locate') });
