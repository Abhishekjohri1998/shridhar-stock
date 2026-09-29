import path from 'node:path';
import cors from 'cors';
import express, { Router } from 'express';
import { env, warnAboutDefaults } from './env';
import { errorMiddleware, handler } from './http';
import { reconcile } from './posting';
import { actionRoutes } from './routes/actions';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { demoRoutes } from './routes/demo';
import { liveRoutes } from './routes/live';
import { reportRoutes } from './routes/reports';
import { roleRoutes } from './routes/roles';
import { startLink } from './billing/link';
import { seedDemo } from './demo/seed';
import { ensureShop, seedAdmin } from './setup';
import { getRepo, initRepo } from './store';

const RECONCILE_EVERY_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  warnAboutDefaults();
  if (env.demo && env.mongoUri) {
    throw new Error('DEMO=1 with MONGO_URI set: demo mode only runs on the local file store, never a database.');
  }
  const repo = await initRepo();
  if (env.demo && (await repo.countPeople()) === 0) {
    await seedDemo(repo);
    console.log('[demo] sample data loaded');
  }
  await ensureShop(repo);
  await seedAdmin(repo);

  const app = express();
  // Behind Caddy on the server, so the client address comes from X-Forwarded-For. The login
  // limit needs the real address, not Caddy's.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '3mb' }));
  app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : true }));

  const api = Router();
  api.get(
    '/health',
    handler(async (_req, res) => {
      res.json({ ok: true, storage: getRepo().kind });
    }),
  );
  api.use(authRoutes);
  api.use(liveRoutes);
  api.use(adminRoutes);
  api.use(roleRoutes);
  api.use(actionRoutes);
  api.use(reportRoutes);
  if (env.demo) api.use(demoRoutes);
  api.use((_req, res) => {
    res.status(404).json({ error: 'No such address' });
  });
  app.use('/api', api);

  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Website build not found. Run npm run build first.');
    });
  });
  app.use(errorMiddleware);

  // The cache is put right from the ledger on start and every few minutes after.
  const check = () =>
    reconcile(getRepo())
      .then((r) => r.fixed.length && console.warn('[stock] reconcile fixed ' + r.fixed.length + ' numbers'))
      .catch((err) => console.error('[stock] reconcile failed', err));
  await check();
  setInterval(check, RECONCILE_EVERY_MS).unref();

  startLink();

  app.listen(env.port, () => {
    console.log('[server] listening on http://localhost:' + env.port);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
