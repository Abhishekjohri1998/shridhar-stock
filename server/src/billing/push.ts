import { billing, linkConfigured } from './link';

/**
 * The only two things stock writes to billing:
 *
 * - a worker's fetched tick on a saved bill's line, which turns billing's given tick on or off;
 * - an address the admin set here for a customer that came from billing.
 *
 * Both are sent in the background: tried once, tried again a moment later, then logged. A
 * failure never reaches the person who ticked; stock's own record is already saved, and billing's
 * given is put right from stock's side the next time the tick changes.
 */
const RETRY_MS = 1500;

function fire(what: string, run: () => Promise<unknown>): Promise<void> {
  if (!linkConfigured()) return Promise.resolve();
  return run()
    .catch(() => new Promise((r) => setTimeout(r, RETRY_MS)).then(run))
    .then(
      () => undefined,
      (err: Error) => console.error('[billing] ' + what + ' failed: ' + err.message),
    );
}

export function pushGiven(billNo: number, i: number, given: boolean): Promise<void> {
  return fire('given tick for bill ' + billNo + ' line ' + (i + 1), () =>
    billing().send('PATCH', '/api/bills/' + billNo + '/lines/' + i + '/given', { given }),
  );
}

export function pushAddress(billingId: string, address: string): Promise<void> {
  return fire('address for customer ' + billingId, () => billing().send('PUT', '/api/customers/' + encodeURIComponent(billingId), { address }));
}
