import { DEFAULT_SETTINGS, type Location, type ShopSettings } from '@stock/core';
import { env } from './env';
import { hashPin } from './pin';
import { newId, type InvRepo } from './store/types';
import { normalisePhone, checkPin } from '@stock/core';

/** There is always exactly one shop. It is made the first time the server starts. */
export async function ensureShop(repo: InvRepo): Promise<Location> {
  const locs = await repo.listLocations();
  const shop = locs.find((l) => l.kind === 'shop');
  if (shop) return shop;
  const made: Location = { id: 'loc_shop', name: 'Shop', nameKn: 'ಅಂಗಡಿ', kind: 'shop', active: true };
  await repo.saveLocation(made);
  return made;
}

export async function shopOf(repo: InvRepo): Promise<Location> {
  return ensureShop(repo);
}

/**
 * Makes the first admin from SEED_ADMIN_PHONE and SEED_ADMIN_PIN, but only while nobody exists:
 * a seed left in the environment can never reset a real admin's PIN or add a second one.
 */
export async function seedAdmin(repo: InvRepo): Promise<void> {
  if (!env.seedAdminPhone || !env.seedAdminPin) return;
  if ((await repo.countPeople()) > 0) {
    console.warn('[setup] SEED_ADMIN_* is set but people already exist, so it is ignored. Remove it.');
    return;
  }
  const phone = normalisePhone(env.seedAdminPhone);
  const bad = checkPin(env.seedAdminPin);
  if (phone.length !== 10 || bad) {
    console.error('[setup] SEED_ADMIN_PHONE must be 10 digits and SEED_ADMIN_PIN 4 to 6 digits. No admin made.');
    return;
  }
  await repo.createPerson({
    id: newId('p'),
    name: env.seedAdminName,
    phone,
    role: 'admin',
    active: true,
    pinHash: hashPin(env.seedAdminPin),
    tv: 1,
    createdAt: new Date().toISOString(),
  });
  console.log('[setup] first admin made for ' + phone + '. Remove SEED_ADMIN_* from the environment now.');
}

/** The shop's settings, with the defaults for anything never set. Kept in meta, id "settings". */
export async function settingsOf(repo: InvRepo): Promise<ShopSettings> {
  const doc = await repo.getDoc<{ id: string } & Partial<ShopSettings>>('meta', 'settings');
  const out: ShopSettings = { ...DEFAULT_SETTINGS };
  if (doc?.roundTo != null) out.roundTo = doc.roundTo;
  if (typeof doc?.bikeMaxItems === 'number') out.bikeMaxItems = doc.bikeMaxItems;
  if (typeof doc?.bikeMaxAmount === 'number') out.bikeMaxAmount = doc.bikeMaxAmount;
  if (typeof doc?.shopLat === 'number' && typeof doc?.shopLng === 'number') {
    out.shopLat = doc.shopLat;
    out.shopLng = doc.shopLng;
  }
  return out;
}

/** Places in the order every screen lists them: the shop first, then godowns by name. */
export function placeOrder(locs: Location[]): Location[] {
  return [...locs].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'shop' ? -1 : 1));
}
