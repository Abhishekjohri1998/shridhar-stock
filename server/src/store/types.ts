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

/** Top-level fields equal to a value, or to one of a list: `{ status: ['ordered', 'confirmed'] }`. */
export type DocFilter = Record<string, string | number | boolean | (string | number)[]>;

/** The file store's reading of a DocFilter, the same as Mongo's. */
export function matchesFilter(doc: Record<string, unknown>, filter: DocFilter): boolean {
  return Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(doc[k] as string) : doc[k] === v));
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

  /** All of a collection, or only the documents matching `filter`, read with a query. */
  listDocs<T extends { id: string }>(col: DocCollection, filter?: DocFilter): Promise<T[]>;
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
