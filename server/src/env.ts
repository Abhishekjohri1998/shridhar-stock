import 'dotenv/config';
import { POLL_BUSY_MS, POLL_IDLE_MS } from './billing/sync';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v == null || v.trim() === '' ? fallback : v.trim();
}

export const env = {
  mongoUri: str('MONGO_URI', ''),
  /**
   * The database inside the cluster. Always its own, never the billing app's: the connection
   * string may be the same cluster the billing app uses, and this is what keeps the two apart.
   */
  mongoDb: str('MONGO_DB', 'inventory'),
  jwtSecret: str('JWT_SECRET', 'dev-only-insecure-secret'),
  port: Number(str('PORT', '4200')),
  /** Overrides where the JSON fallback store lives. Used by the tests. */
  dataDir: str('DATA_DIR', ''),
  corsOrigins: str('CORS_ORIGIN', 'http://localhost:5174').split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * The first admin, created on start when nobody can sign in yet. Set these once, start the
   * server, then remove them: after that the admin changes their PIN from the screen.
   */
  seedAdminPhone: str('SEED_ADMIN_PHONE', ''),
  seedAdminPin: str('SEED_ADMIN_PIN', ''),
  seedAdminName: str('SEED_ADMIN_NAME', 'Admin'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  /**
   * The billing server to read bills from, and the shop PIN to sign in with. Both empty means no
   * link. The PIN is a secret: it lives only in server/.env on the server.
   */
  billingUrl: str('BILLING_URL', ''),
  billingPin: str('BILLING_PIN', ''),
  /** How often to read when the shop is quiet, and when a bill is open. See billing/sync.ts. */
  billingEveryMs: Number(str('BILLING_EVERY_MS', String(POLL_IDLE_MS))),
  billingBusyMs: Number(str('BILLING_BUSY_MS', String(POLL_BUSY_MS))),
  /**
   * The shared secret billing sends to /api/billing-link (item search, prices, live drafts). Empty
   * means that door does not exist. A secret: server/.env only, the same value as billing's.
   */
  linkKey: str('LINK_KEY', ''),
  /**
   * The handwriting reader. The key is the owner's own, set in server/.env only. Without it every
   * handwritten line waits for a person. READER_FAKE is for the tests: a file of fixed readings.
   */
  anthropicKey: str('ANTHROPIC_API_KEY', ''),
  readerFake: str('READER_FAKE', ''),
  readerCapRupees: Number(str('READER_CAP_RUPEES', '500')),
  rupeesPerDollar: Number(str('RUPEES_PER_DOLLAR', '86')),
  /** Demo mode: sample data, "log in as" any role, and the walkthrough. File store only. */
  demo: str('DEMO', '') === '1',
};

export function warnAboutDefaults(): void {
  if (env.jwtSecret === 'dev-only-insecure-secret') {
    console.warn('[warn] JWT_SECRET is unset. Anyone could mint a login token. Set it before deploying.');
  }
  if (!env.mongoUri) {
    console.warn('[warn] MONGO_URI is unset, so data is going to server/.data/, not MongoDB.');
  }
  if (env.mongoDb !== 'inventory') {
    console.warn('[warn] MONGO_DB is "' + env.mongoDb + '". Make sure it is not the billing app\'s database.');
  }
}
