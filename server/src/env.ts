import 'dotenv/config';

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
