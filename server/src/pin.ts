import crypto from 'node:crypto';

/**
 * PINs are stored as salted scrypt hashes: `scrypt$<salt>$<hash>`, both hex.
 *
 * A PIN is only 4 to 6 digits, so a stolen hash could be brute-forced whatever the function; what
 * the hash buys is that the database never holds anyone's PIN in the clear, and that the login
 * rate limit, not the hash, is what stands between a guesser and an account.
 */
const KEYLEN = 32;

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, KEYLEN);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), want.length);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
