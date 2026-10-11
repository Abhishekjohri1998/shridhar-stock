import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { isActiveRole, retiredRoleMessage, type Person, type Role } from '@stock/core';
import { env } from './env';
import { HttpError } from './http';
import { getRepo } from './store';
import type { PersonRecord } from './store/types';

const TOKEN_TTL = '30d';

interface TokenBody {
  pid: string;
  role: Role;
  tv: number;
}

export function issueToken(p: PersonRecord): string {
  const body: TokenBody = { pid: p.id, role: p.role, tv: p.tv };
  return jwt.sign(body, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

/** What a person may see of themselves or anyone else: never the PIN hash or token version. */
export function publicPerson(p: PersonRecord): Person {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    role: p.role,
    ...(p.linkedId ? { linkedId: p.linkedId } : {}),
    active: p.active,
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    person?: PersonRecord;
    /** The worker the admin is working as (X-Act-As). `person` stays the admin. */
    actingFor?: PersonRecord;
  }
}

/** The header the admin's worker screens send to work as one worker. */
export const ACT_AS_HEADER = 'x-act-as';

/** Whose screen this is: the worker the admin acts for, else the person signed in. */
export function who(req: Request): PersonRecord {
  return req.actingFor ?? req.person!;
}

/** Who did it, for the record: the worker in `by`, and the admin in `actor` when they tapped it for them. */
export function audit(req: Request): { by: string; actor?: string } {
  return req.actingFor ? { by: req.actingFor.id, actor: req.person!.id } : { by: req.person!.id };
}

/**
 * Lets a request through only for a signed-in, switched-on person in one of `roles`.
 *
 * The person is read fresh from the store on every request, not trusted from the token: switching
 * someone off, changing their role or resetting their PIN (which bumps `tv`) takes effect at once,
 * on every device they are signed in on.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      next(new HttpError(401, 'Sign in first'));
      return;
    }
    let body: TokenBody;
    try {
      body = jwt.verify(token, env.jwtSecret) as TokenBody;
    } catch {
      next(new HttpError(401, 'Your session has expired. Sign in again.'));
      return;
    }
    getRepo()
      .getPerson(body.pid)
      .then((p) => {
        if (!p || !p.active || p.tv !== body.tv) throw new HttpError(401, 'Sign in again');
        // An old session of a removed login ends too, with the same plain message as the login.
        if (!isActiveRole(p.role)) throw new HttpError(401, retiredRoleMessage(p.role));
        if (roles.length && !roles.includes(p.role)) throw new HttpError(403, 'This is not open to your role');
        req.person = p;
        // Working as a worker: only the admin may, and only as a switched-on worker.
        const actAs = (req.header(ACT_AS_HEADER) ?? '').trim();
        if (!actAs) return next();
        if (p.role !== 'admin') throw new HttpError(403, 'Only the admin can work as another person');
        return getRepo()
          .getPerson(actAs)
          .then((w) => {
            if (!w || !w.active || (w.role !== 'worker' && w.role !== 'godown')) throw new HttpError(400, 'That is not a working worker');
            req.actingFor = w;
            next();
          });
      })
      .catch(next);
  };
}

export const anyone = requireRole();
