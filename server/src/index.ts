import path from 'node:path';
import cors from 'cors';
import express, { Router } from 'express';
import { env, warnAboutDefaults } from './env';
import { errorMiddleware, handler } from './http';
import { reconcile } from './posting';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { ensureShop, seedAdmin } from './setup';
import { getRepo, initRepo } from './store';

const RECONCILE_EVERY_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  warnAboutDefaults();
  const repo = await initRepo();
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
  api.use(adminRoutes);
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

  app.listen(env.port, () => {
    console.log('[server] listening on http://localhost:' + env.port);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
