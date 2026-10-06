import path from 'node:path';
import { env } from '../env';
import { createFileRepo } from './file';
import { createMongoRepo } from './mongo';
import type { InvRepo } from './types';

let repo: InvRepo | null = null;

export async function initRepo(): Promise<InvRepo> {
  if (repo) return repo;
  const base = env.mongoUri
    ? await createMongoRepo(env.mongoUri, env.mongoDb)
    : await createFileRepo(env.dataDir || path.join(__dirname, '..', '..', '.data'));
  repo = withCache(base);
  console.log('[store] using ' + (repo.kind === 'mongo' ? 'MongoDB database "' + env.mongoDb + '"' : 'the local JSON file'));
  return repo;
}

export function getRepo(): InvRepo {
  if (!repo) throw new Error('Storage is not ready yet');
  return repo;
}

let version = 0;
/** Goes up on every write through the store, so anything cached from it knows it is stale. */
export function dataVersion(): number {
  return version;
}

/** JSON round trip: items and places are plain JSON, and this is quicker than structuredClone. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Items and places change rarely and are read by nearly every screen, so they are kept in memory.
 * Every write through the store goes through here and bumps the version; an item or place write
 * (an edit, an import, a demo reset) drops that list, so the next read is fresh. What comes out
 * is always a copy: callers change items in hand before saving them.
 */
export function withCache(inner: InvRepo): InvRepo {
  let items: ReturnType<InvRepo['listItems']> | null = null;
  let locations: ReturnType<InvRepo['listLocations']> | null = null;
  const dropItems = () => {
    items = null;
  };
  const dropPlaces = () => {
    locations = null;
  };
  /** A write: bump the version before and after, and drop what it touches. */
  const w =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>, drop?: () => void) =>
    async (...a: A): Promise<R> => {
      version++;
      drop?.();
      try {
        return await fn(...a);
      } finally {
        version++;
        drop?.();
      }
    };
  const out: InvRepo = {
    ...inner,
    listItems: async () => {
      const p = (items ??= inner.listItems().catch((err) => {
        items = null;
        throw err;
      }));
      return copy(await p);
    },
    getItem: async (id) => (await out.listItems()).find((i) => i.id === id) ?? null,
    listLocations: async () => {
      const p = (locations ??= inner.listLocations().catch((err) => {
        locations = null;
        throw err;
      }));
      return copy(await p);
    },
    createPerson: w(inner.createPerson),
    updatePerson: w(inner.updatePerson),
    saveLocation: w(inner.saveLocation, dropPlaces),
    saveItem: w(inner.saveItem, dropItems),
    insertMove: w(inner.insertMove),
    incStock: w(inner.incStock),
    setStock: w(inner.setStock),
    putDoc: w(inner.putDoc),
    deleteDoc: w(inner.deleteDoc),
    nextNo: w(inner.nextNo),
    ...(inner.eraseAll
      ? {
          eraseAll: w(inner.eraseAll, () => {
            dropItems();
            dropPlaces();
          }),
        }
      : {}),
  };
  return out;
}

export type { InvRepo };
