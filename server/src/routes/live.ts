import crypto from 'node:crypto';
import { Router } from 'express';
import { anyone } from '../auth';
import { subscribe } from '../events';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';

/**
 * The live stream. A browser's EventSource cannot send a sign-in header, and a token in the
 * address would end up in proxy logs, so the page first asks for a ticket (signed in as usual),
 * good once and for one minute, and opens the stream with that.
 */
export const liveRoutes = Router();

const tickets = new Map<string, { personId: string; until: number }>();

liveRoutes.post(
  '/events/ticket',
  anyone,
  handler(async (req, res) => {
    const now = Date.now();
    for (const [k, t] of tickets) if (t.until < now) tickets.delete(k);
    const ticket = crypto.randomBytes(18).toString('base64url');
    tickets.set(ticket, { personId: req.person!.id, until: now + 60_000 });
    res.json({ ticket });
  }),
);

liveRoutes.get(
  '/events',
  handler(async (req, res) => {
    const t = tickets.get(String(req.query.ticket ?? ''));
    tickets.delete(String(req.query.ticket ?? ''));
    if (!t || t.until < Date.now()) throw new HttpError(401, 'Ask for a new ticket');
    const person = await getRepo().getPerson(t.personId);
    if (!person || !person.active) throw new HttpError(401, 'Sign in again');
    subscribe(person, res);
  }),
);
