import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { HttpError } from './http';
import { dataDir } from './store';
import { BACKUP_COLLECTIONS, CORE_COLLECTIONS, DOC_COLLECTIONS, type BackupCollection, type BackupData, type InvRepo } from './store/types';

/**
 * A whole-store backup: every collection the store keeps, in one JSON file.
 *
 * Restoring checks the whole file before anything is touched, saves a safety backup of what is
 * there now on the server, and only then replaces everything (see InvRepo.restoreAll).
 */
export const BACKUP_FORMAT = 'shridhar-stock-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  storage: 'mongo' | 'file';
  counts: Record<string, number>;
  collections: BackupData;
}

export async function makeBackup(repo: InvRepo): Promise<BackupFile> {
  const collections = await repo.dumpAll();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    storage: repo.kind,
    counts: Object.fromEntries(BACKUP_COLLECTIONS.map((c) => [c, collections[c].length])),
    collections,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;

/** The field(s) each collection is unique by, and the fields every record must carry. */
const KEYS: Record<BackupCollection, { key: (d: Record<string, unknown>) => unknown; need: [string, 'string' | 'number'][] }> = {
  people: { key: (d) => d.id, need: [['id', 'string'], ['phone', 'string'], ['role', 'string'], ['pinHash', 'string']] },
  locations: { key: (d) => d.id, need: [['id', 'string'], ['kind', 'string']] },
  items: { key: (d) => d.id, need: [['id', 'string']] },
  stockmoves: { key: (d) => d.key, need: [['id', 'string'], ['key', 'string'], ['itemId', 'string'], ['qty', 'number']] },
  stock: { key: (d) => d.itemId + '|' + d.locationId, need: [['itemId', 'string'], ['locationId', 'string'], ['qty', 'number']] },
  counters: { key: (d) => d.series, need: [['series', 'string'], ['value', 'number']] },
  ...(Object.fromEntries(DOC_COLLECTIONS.map((c) => [c, { key: (d: Record<string, unknown>) => d.id, need: [['id', 'string']] }])) as Record<
    (typeof DOC_COLLECTIONS)[number],
    { key: (d: Record<string, unknown>) => unknown; need: [string, 'string' | 'number'][] }
  >),
};

const bad = (msg: string) => new HttpError(400, 'This backup file cannot be restored: ' + msg + '. Nothing was changed.');

/**
 * Checks a backup file top to bottom and returns its collections. Refuses, with a plain reason,
 * anything that is not one of ours, is from a newer version, is cut short, or would leave the
 * shop with nobody able to sign in as admin.
 */
export function validateBackup(raw: unknown): BackupData {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw bad('it is not a stock backup file');
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw bad('its version is missing or wrong');
  if (version > BACKUP_VERSION) throw bad('it was made by a newer version of the stock app (version ' + version + ')');
  const cols = raw.collections;
  if (!isObj(cols)) throw bad('it has no data in it');
  for (const name of Object.keys(cols)) {
    if (!(BACKUP_COLLECTIONS as readonly string[]).includes(name)) throw bad('it has an unknown part "' + name + '"');
  }
  const counts = isObj(raw.counts) ? raw.counts : {};
  const out = {} as BackupData;
  for (const name of BACKUP_COLLECTIONS) {
    const list = cols[name];
    if (list === undefined) {
      // A part added to the app after this backup was made is simply empty. The core ones never are missing.
      if ((CORE_COLLECTIONS as readonly string[]).includes(name)) throw bad('the part "' + name + '" is missing');
      out[name] = [];
      continue;
    }
    if (!Array.isArray(list)) throw bad('the part "' + name + '" is damaged');
    if (counts[name] !== undefined && counts[name] !== list.length) {
      throw bad('the part "' + name + '" should have ' + String(counts[name]) + ' records but has ' + list.length + ' (the file is cut short or changed)');
    }
    const spec = KEYS[name];
    const seen = new Set<unknown>();
    list.forEach((d, i) => {
      if (!isObj(d)) throw bad('record ' + (i + 1) + ' of "' + name + '" is damaged');
      for (const [f, type] of spec.need) {
        if (type === 'string' ? !isStr(d[f]) : typeof d[f] !== 'number' || !Number.isFinite(d[f])) {
          throw bad('record ' + (i + 1) + ' of "' + name + '" has no ' + f);
        }
      }
      const k = spec.key(d);
      if (seen.has(k)) throw bad('"' + name + '" has ' + String(k) + ' twice');
      seen.add(k);
    });
    out[name] = list as Record<string, unknown>[];
  }
  const phones = new Set<unknown>();
  for (const p of out.people) {
    if (phones.has(p.phone)) throw bad('two people have the phone ' + String(p.phone));
    phones.add(p.phone);
  }
  const canSignIn = out.people.some((p) => p.role === 'admin' && p.active !== false && String(p.pinHash).startsWith('scrypt$'));
  if (!canSignIn) throw bad('it has no admin who could sign in');
  return out;
}

// ---------------------------------------------------------------- safety backups on the server

const SAFETY_KEPT = 20;
const SAFETY_NAME = /^safety-[0-9TZ-]+\.json$/;

export function backupsDir(): string {
  return env.backupDir || path.join(dataDir(), 'backups');
}

/** Saves the backup on the server's disk, keeps the newest few, and returns its file name. */
export async function saveSafetyBackup(b: BackupFile): Promise<string> {
  const dir = backupsDir();
  await fs.mkdir(dir, { recursive: true });
  const name = 'safety-' + b.exportedAt.replace(/[:.]/g, '-') + '.json';
  const file = path.join(dir, name);
  await fs.writeFile(file + '.tmp', JSON.stringify(b));
  await fs.rename(file + '.tmp', file);
  const old = (await listSafetyBackups()).slice(SAFETY_KEPT);
  for (const o of old) await fs.rm(path.join(dir, o.name), { force: true });
  return name;
}

export async function listSafetyBackups(): Promise<{ name: string; size: number; at: string }[]> {
  let names: string[];
  try {
    names = await fs.readdir(backupsDir());
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => SAFETY_NAME.test(n))) {
    const st = await fs.stat(path.join(backupsDir(), name));
    out.push({ name, size: st.size, at: st.mtime.toISOString() });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** The path of one safety backup, or null for a name that is not one (no path tricks). */
export function safetyPath(name: string): string | null {
  return SAFETY_NAME.test(name) ? path.join(backupsDir(), name) : null;
}

// ---------------------------------------------------------------- erasing

/**
 * Setup → Settings → "Erasing everything". Two ways to start again:
 *
 * - `everything`: only the people (logins and PINs), the places and the shop's settings stay, so
 *   the admin can still sign in and set the shop up again.
 * - `stock`: the items (with their units, prices, names and supplier links), suppliers, carriers
 *   and vehicles stay too; every number and every record of what happened goes.
 *
 * Every collection is listed for both, on purpose: a collection added later does not compile until
 * someone decides whether an erase keeps it.
 */
export const ERASE_MODES = ['everything', 'stock'] as const;
export type EraseMode = (typeof ERASE_MODES)[number];

export const ERASE_KEEPS: Record<BackupCollection, Record<EraseMode, boolean>> = {
  people: { everything: true, stock: true },
  locations: { everything: true, stock: true },
  meta: { everything: true, stock: true }, // settings, learned words, link status (low alerts are dropped below)
  items: { everything: false, stock: true },
  suppliers: { everything: false, stock: true },
  carriers: { everything: false, stock: true },
  vehicles: { everything: false, stock: true },
  unitChanges: { everything: false, stock: true }, // the record of an item's unit changes goes with the item
  stockmoves: { everything: false, stock: false },
  stock: { everything: false, stock: false },
  counters: { everything: false, stock: false },
  bills: { everything: false, stock: false },
  customers: { everything: false, stock: false },
  transfers: { everything: false, stock: false },
  pos: { everything: false, stock: false },
  deliveries: { everything: false, stock: false },
  deliveryPhotos: { everything: false, stock: false },
  orders: { everything: false, stock: false },
  trips: { everything: false, stock: false },
  lots: { everything: false, stock: false },
  loads: { everything: false, stock: false },
  orderDrafts: { everything: false, stock: false },
};

/** Meta records that describe stock, not settings: they go with the stock. */
const META_DROPPED = new Set(['lowAlerts']);
/** The meta record that tells the billing sync to skip bills made before an erase. */
export const ERASE_CURSOR_ID = 'eraseCursor';

export interface EraseCursor {
  id: typeof ERASE_CURSOR_ID;
  /** Bills numbered up to this were made before the erase: the sync never reads them again. */
  billNo: number;
  at: string;
  mode: EraseMode;
  by: string;
}

/** What is left of `data` after an erase in `mode`, with the sync cursor written into meta. */
export function erasedData(data: BackupData, mode: EraseMode, cursor: EraseCursor): BackupData {
  const out = {} as BackupData;
  for (const name of BACKUP_COLLECTIONS) out[name] = ERASE_KEEPS[name][mode] ? data[name] : [];
  out.meta = [...out.meta.filter((m) => !META_DROPPED.has(String(m.id)) && m.id !== ERASE_CURSOR_ID), cursor as unknown as Record<string, unknown>];
  return out;
}
