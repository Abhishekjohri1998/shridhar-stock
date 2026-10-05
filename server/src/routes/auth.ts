import { Router } from 'express';
import { z } from 'zod';
import { checkPin, normalisePhone } from '@stock/core';
import { anyone, issueToken, publicPerson } from '../auth';
import { handler, HttpError } from '../http';
import { hashPin, verifyPin } from '../pin';
import { lockedFor, recordFailure, recordSuccess } from '../ratelimit';
import { getRepo } from '../store';

export const authRoutes = Router();

const loginBody = z.object({ phone: z.string().max(20), pin: z.string().max(12) });

authRoutes.post(
  '/auth/login',
  handler(async (req, res) => {
    const { phone: rawPhone, pin } = loginBody.parse(req.body);
    const phone = normalisePhone(rawPhone);
    const ip = req.ip ?? '';
    const wait = lockedFor(ip, phone);
    if (wait > 0) {
      throw new HttpError(429, 'Too many wrong PINs. Try again in ' + Math.ceil(wait / 60000) + ' minutes.');
    }
    const p = phone ? await getRepo().findPersonByPhone(phone) : null;
    // One message for every way of failing, so the login cannot be used to find out who has an account.
    if (!p || !p.active || !verifyPin(pin, p.pinHash)) {
      recordFailure(ip, phone);
      throw new HttpError(401, 'Wrong phone number or PIN');
    }
    recordSuccess(ip, phone);
    // Suppliers are contacts now and do not sign in. Said plainly, since the PIN was right.
    if (p.role === 'vendor') throw new HttpError(403, 'Suppliers no longer sign in here. Call the shop about your orders.');
    res.json({ token: issueToken(p), person: publicPerson(p) });
  }),
);

authRoutes.get(
  '/me',
  anyone,
  handler(async (req, res) => {
    res.json(publicPerson(req.person!));
  }),
);

const pinBody = z.object({ oldPin: z.string().max(12), newPin: z.string().max(12) });

/** Changing your own PIN signs you out everywhere, this device included. */
authRoutes.post(
  '/auth/pin',
  anyone,
  handler(async (req, res) => {
    const { oldPin, newPin } = pinBody.parse(req.body);
    const me = req.person!;
    if (!verifyPin(oldPin, me.pinHash)) throw new HttpError(400, 'The current PIN is wrong');
    const bad = checkPin(newPin);
    if (bad) throw new HttpError(400, bad);
    await getRepo().updatePerson(me.id, { pinHash: hashPin(newPin), tv: me.tv + 1 });
    res.json({ ok: true });
  }),
);
