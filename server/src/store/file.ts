import fs from 'node:fs/promises';
import path from 'node:path';
import type { Item, Location, StockLevel, StockMove } from '@stock/core';
import { levelsFromMoves, type InvRepo, type MoveQuery, type PersonRecord } from './types';

interface Db {
  people: PersonRecord[];
  locations: Location[];
  items: Item[];
  moves: StockMove[];
  stock: StockLevel[];
}

const empty = (): Db => ({ people: [], locations: [], items: [], moves: [], stock: [] });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The JSON-file store. Every write goes through one promise chain, so two requests can never
 * interleave a read-modify-write, and the file is replaced by rename so a crash mid-write leaves
 * the old one intact.
 */
export async function createFileRepo(dir: string): Promise<InvRepo> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'inventory.json');
  let db: Db;
  try {
    db = { ...empty(), ...(JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Db>) };
  } catch {
    db = empty();
  }

  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const flush = async () => {
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db));
    await fs.rename(tmp, file);
  };
  const write = <T>(fn: () => T): Promise<T> =>
    serial(async () => {
      const out = fn();
      await flush();
      return out;
    });

  const stockRow = (itemId: string, locationId: string): StockLevel => {
    let row = db.stock.find((s) => s.itemId === itemId && s.locationId === locationId);
    if (!row) {
      row = { itemId, locationId, qty: 0 };
      db.stock.push(row);
    }
    return row;
  };

  return {
    kind: 'file',

    countPeople: () => serial(() => db.people.length),
    listPeople: () => serial(() => clone(db.people)),
    getPerson: (id) => serial(() => clone(db.people.find((p) => p.id === id) ?? null)),
    findPersonByPhone: (phone) => serial(() => clone(db.people.find((p) => p.phone === phone) ?? null)),
    createPerson: (p) =>
      write(() => {
        if (db.people.some((x) => x.phone === p.phone)) return false;
        db.people.push(clone(p));
        return true;
      }),
    updatePerson: (id, patch) =>
      write(() => {
        const p = db.people.find((x) => x.id === id);
        if (!p) return null;
        Object.assign(p, clone(patch));
        return clone(p);
      }),

    listLocations: () => serial(() => clone(db.locations)),
    saveLocation: (loc) =>
      write(() => {
        const i = db.locations.findIndex((l) => l.id === loc.id);
        if (i >= 0) db.locations[i] = clone(loc);
        else db.locations.push(clone(loc));
      }),

    listItems: () => serial(() => clone(db.items)),
    getItem: (id) => serial(() => clone(db.items.find((i) => i.id === id) ?? null)),
    saveItem: (item) =>
      write(() => {
        const i = db.items.findIndex((x) => x.id === item.id);
        if (i >= 0) db.items[i] = clone(item);
        else db.items.push(clone(item));
      }),

    insertMove: (m) =>
      write(() => {
        if (db.moves.some((x) => x.key === m.key)) return false;
        db.moves.push(clone(m));
        return true;
      }),
    listMoves: (q: MoveQuery) =>
      serial(() => {
        let out = db.moves.filter(
          (m) =>
            (!q.itemId || m.itemId === q.itemId) &&
            (!q.locationId || m.from === q.locationId || m.to === q.locationId) &&
            (!q.from || m.at >= q.from) &&
            (!q.to || m.at < q.to),
        );
        out = out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
        return clone(q.limit ? out.slice(0, q.limit) : out);
      }),
    ledgerLevels: (itemIds) =>
      serial(() => levelsFromMoves(itemIds ? db.moves.filter((m) => itemIds.includes(m.itemId)) : db.moves)),

    listStock: (itemIds) => serial(() => clone(itemIds ? db.stock.filter((s) => itemIds.includes(s.itemId)) : db.stock)),
    incStock: (itemId, locationId, delta) =>
      write(() => {
        const row = stockRow(itemId, locationId);
        row.qty = Math.round((row.qty + delta) * 1000) / 1000;
      }),
    setStock: (itemId, locationId, qty) =>
      write(() => {
        stockRow(itemId, locationId).qty = qty;
      }),

    close: () => serial(() => undefined),
  };
}
