import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@stock/core';
import { issueToken, publicPerson } from '../auth';
import { DEMO_PEOPLE, seedDemo } from '../demo/seed';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';

/**
 * Only mounted when the server runs with DEMO=1, which it refuses to do against a database.
 * "Log in as" skips the PIN so the walkthrough can move between roles in one click.
 */
export const demoRoutes = Router();

demoRoutes.get(
  '/demo/people',
  handler(async (_req, res) => {
    res.json(DEMO_PEOPLE.map((p) => ({ role: p.role, name: p.name, phone: p.phone })));
  }),
);

demoRoutes.post(
  '/demo/login-as',
  handler(async (req, res) => {
    const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);
    const demo = DEMO_PEOPLE.find((p) => p.role === role);
    const p = demo ? await getRepo().findPersonByPhone(demo.phone) : null;
    if (!p || !p.active) throw new HttpError(404, 'No demo person for that role. Reset the demo.');
    res.json({ token: issueToken(p), person: publicPerson(p) });
  }),
);

demoRoutes.post(
  '/demo/reset',
  handler(async (_req, res) => {
    const repo = getRepo();
    if (!repo.eraseAll) throw new HttpError(400, 'Reset only works on the demo file store');
    await repo.eraseAll();
    await seedDemo(repo);
    res.json({ ok: true });
  }),
);
