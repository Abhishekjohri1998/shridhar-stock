import type { Item, Location, Person, StockLevel, StockMove } from '@stock/core';

/** A person as stored. The PIN hash and token version never leave the server. */
export interface PersonRecord extends Person {
  pinHash: string;
  /** Token version. Bumped to sign someone out everywhere. */
  tv: number;
  createdAt: string;
}

/**
 * The kinds of record kept as whole documents, each with an `id`: bills read from billing,
 * customers read from billing, and everything that moves stock between people.
 */
export const DOC_COLLECTIONS = ['bills', 'customers', 'transfers', 'suppliers', 'pos', 'deliveries', 'orders', 'vehicles', 'meta'] as const;
export type DocCollection = (typeof DOC_COLLECTIONS)[number];

/** A comparison on one field. `ne` also matches a missing field; `exists` means present and not null. */
export interface DocRange {
  gt?: string | number;
  gte?: string | number;
  lt?: string | number;
  lte?: string | number;
  ne?: string | number | boolean;
  exists?: boolean;
}
export type DocCond = string | number | boolean | (string | number)[] | DocRange;

/**
 * Fields equal to a value, one of a list (`{ status: ['ordered', 'confirmed'] }`), or a range
 * (`{ at: { gte: today } }`). A key may be a dotted path into a list of subdocuments, as in Mongo:
 * `{ 'lines.state': 'to-confirm' }` matches a bill with any such line.
 */
export type DocFilter = Record<string, DocCond>;

/** How to read a collection: which, in what order, how many, and which fields. */
export interface DocQuery {
  filter?: DocFilter;
  /** Field to 1 (ascending) or -1 (descending), in priority order. */
  sort?: Record<string, 1 | -1>;
  limit?: number;
  /** Top-level fields to return; `id` always comes back. */
  fields?: string[];
}

/** Every value at a dotted path, looking through lists the way Mongo does. */
function valuesAt(doc: unknown, path: string[]): unknown[] {
  if (!path.length) return Array.isArray(doc) ? [doc, ...doc] : [doc];
  if (Array.isArray(doc)) return doc.flatMap((d) => valuesAt(d, path));
  if (doc == null || typeof doc !== 'object') return [undefined];
  return valuesAt((doc as Record<string, unknown>)[path[0]!], path.slice(1));
}

function condHolds(vals: unknown[], c: DocCond): boolean {
  if (Array.isArray(c)) return vals.some((v) => c.includes(v as string));
  if (c !== null && typeof c === 'object') {
    const r = c;
    if (r.exists != null && vals.some((v) => v != null) !== r.exists) return false;
    if ('ne' in r && vals.some((v) => v === r.ne)) return false;
    const ranged = r.gt != null || r.gte != null || r.lt != null || r.lte != null;
    if (!ranged) return true;
    return vals.some(
      (v) =>
        v != null &&
        typeof v === typeof (r.gt ?? r.gte ?? r.lt ?? r.lte) &&
        (r.gt == null || (v as number) > (r.gt as number)) &&
        (r.gte == null || (v as number) >= (r.gte as number)) &&
        (r.lt == null || (v as number) < (r.lt as number)) &&
        (r.lte == null || (v as number) <= (r.lte as number)),
    );
  }
  return vals.some((v) => v === c);
}

/** The file store's reading of a DocFilter, the same as Mongo's. */
export function matchesFilter(doc: Record<string, unknown>, filter: DocFilter): boolean {
  return Object.entries(filter).every(([k, c]) => condHolds(valuesAt(doc, k.split('.')), c));
}

/** The file store's reading of a DocQuery's sort, limit and fields, over already-filtered docs. */
export function shapeDocs<T>(docs: Record<string, unknown>[], q: DocQuery): T[] {
  let out = docs;
  const sort = Object.entries(q.sort ?? {});
  if (sort.length) {
    out = [...out].sort((a, b) => {
      for (const [k, dir] of sort) {
        const x = a[k] as string | number | undefined;
        const y = b[k] as string | number | undefined;
        if (x === y) continue;
        if (x == null) return -dir;
        if (y == null) return dir;
        return (x < y ? -1 : 1) * dir;
      }
      return 0;
    });
  }
  if (q.limit) out = out.slice(0, q.limit);
  if (q.fields) {
    const keep = ['id', ...q.fields];
    out = out.map((d) => Object.fromEntries(keep.filter((k) => k in d).map((k) => [k, d[k]])));
  }
  return out as T[];
}

export interface MoveQuery {
  itemId?: string;
  locationId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Everything the server stores. Two implementations: MongoDB for the shop, a JSON file for the
 * tests and for a laptop with no database. Both must behave the same; the tests run against the
 * file one.
 */
export interface InvRepo {
  kind: 'mongo' | 'file';

  countPeople(): Promise<number>;
  listPeople(): Promise<PersonRecord[]>;
  getPerson(id: string): Promise<PersonRecord | null>;
  findPersonByPhone(phone: string): Promise<PersonRecord | null>;
  /** Refuses (returns false) when the phone is already taken. */
  createPerson(p: PersonRecord): Promise<boolean>;
  updatePerson(id: string, patch: Partial<Omit<PersonRecord, 'id'>>): Promise<PersonRecord | null>;

  listLocations(): Promise<Location[]>;
  saveLocation(loc: Location): Promise<void>;

  listItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | null>;
  saveItem(item: Item): Promise<void>;

  /** Adds a move to the ledger. False, and nothing changes, if its key is already there. */
  insertMove(m: StockMove): Promise<boolean>;
  listMoves(q: MoveQuery): Promise<StockMove[]>;
  /** What the ledger says each item has in each place. The truth the cache is checked against. */
  ledgerLevels(itemIds?: string[]): Promise<StockLevel[]>;

  listStock(itemIds?: string[]): Promise<StockLevel[]>;
  incStock(itemId: string, locationId: string, delta: number): Promise<void>;
  setStock(itemId: string, locationId: string, qty: number): Promise<void>;

  /**
   * All of a collection, or only the documents matching `filter`, read with a query. A DocQuery
   * adds the order, a limit and the fields wanted.
   */
  listDocs<T extends { id: string }>(col: DocCollection, filter?: DocFilter | DocQuery): Promise<T[]>;
  getDoc<T extends { id: string }>(col: DocCollection, id: string): Promise<T | null>;
  /** Adds or replaces the whole document. */
  putDoc<T extends { id: string }>(col: DocCollection, doc: T): Promise<void>;
  deleteDoc(col: DocCollection, id: string): Promise<void>;
  /** The next number in a series (transfers, purchase orders), starting at 1. */
  nextNo(series: string): Promise<number>;

  /** Demo only, and only on the file store: empties everything. The Mongo store has none. */
  eraseAll?(): Promise<void>;

  close(): Promise<void>;
}

const QUERY_KEYS = new Set(['filter', 'sort', 'limit', 'fields']);
/** A bare filter, or a full query, as a full query. */
export function asQuery(f?: DocFilter | DocQuery): DocQuery {
  if (!f) return {};
  const keys = Object.keys(f);
  return keys.length && keys.every((k) => QUERY_KEYS.has(k)) ? (f as DocQuery) : { filter: f as DocFilter };
}

export function newId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Sums moves into per-place levels. Shared by the file store and the tests. */
export function levelsFromMoves(moves: StockMove[]): StockLevel[] {
  const map = new Map<string, StockLevel>();
  const add = (itemId: string, locationId: string, d: number) => {
    const k = itemId + '|' + locationId;
    const cur = map.get(k) ?? { itemId, locationId, qty: 0 };
    cur.qty = Math.round((cur.qty + d) * 1000) / 1000;
    map.set(k, cur);
  };
  for (const m of moves) {
    if (m.from) add(m.itemId, m.from, -m.qty);
    if (m.to) add(m.itemId, m.to, m.qty);
  }
  return [...map.values()];
}
