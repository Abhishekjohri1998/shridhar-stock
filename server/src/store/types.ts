import type { Item, Location, Person, StockLevel, StockMove } from '@stock/core';

/** A person as stored. The PIN hash and token version never leave the server. */
export interface PersonRecord extends Person {
  pinHash: string;
  /** Token version. Bumped to sign someone out everywhere. */
  tv: number;
  createdAt: string;
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
