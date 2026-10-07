import mongoose, { Schema } from 'mongoose';
import type { Item, Location, StockLevel, StockMove } from '@stock/core';
import { MOVE_KINDS, ROLES, withLowAt } from '@stock/core';
import { asQuery, DOC_COLLECTIONS, type DocCollection, type DocCond, type DocFilter, type DocQuery, type InvRepo, type MoveQuery, type PersonRecord } from './types';

/*
 * Schema style, as in the billing app: no __v, no _id on subdocuments, and an optional field is
 * `required: false` with a default, never `required: true` with one (a default makes `required`
 * meaningless and hides a missing value). scripts/schematest.js checks every schema here.
 */

const personSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ROLES },
    linkedId: { type: String, required: false },
    active: { type: Boolean, required: false, default: true },
    pinHash: { type: String, required: true },
    tv: { type: Number, required: false, default: 1 },
    createdAt: { type: String, required: true },
  },
  { versionKey: false },
);

const locationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    nameKn: { type: String, required: false, default: '' },
    kind: { type: String, required: true, enum: ['shop', 'godown'] },
    address: { type: String, required: false },
    active: { type: Boolean, required: false, default: true },
    layout: { type: Schema.Types.Mixed, required: false },
  },
  { versionKey: false },
);

const slabSchema = new Schema({ minQty: { type: Number, required: true }, rate: { type: Number, required: true } }, { _id: false });

const unitSchema = new Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: false, default: '' },
    labelKn: { type: String, required: false, default: '' },
    perBase: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    slabs: { type: [slabSchema], required: false, default: undefined },
    min: { type: Number, required: false },
    max: { type: Number, required: false },
    cost: { type: Number, required: false },
  },
  { _id: false },
);

const aliasSchema = new Schema({ text: { type: String, required: true }, unit: { type: String, required: false } }, { _id: false });

const itemSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    nameEn: { type: String, required: false, default: '' },
    nameKn: { type: String, required: false, default: '' },
    category: { type: String, required: false },
    // Mongoose gives arrays an empty default, which would make `required` meaningless; the
    // validator is what refuses an item with no units.
    units: {
      type: [unitSchema],
      required: true,
      default: undefined,
      validate: { validator: (v: unknown[]) => Array.isArray(v) && v.length > 0, message: 'An item needs its base unit' },
    },
    defaultUnit: { type: String, required: false },
    sellUnit: { type: String, required: false },
    suppliers: { type: [String], required: false, default: undefined },
    aliases: { type: [aliasSchema], required: false, default: [] },
    racks: { type: Schema.Types.Mixed, required: false, default: {} },
    // The old level per place. Kept as saved; new saves write lowAt instead.
    reorderAt: { type: Schema.Types.Mixed, required: false },
    lowAt: { type: Schema.Types.Mixed, required: false },
    // Running out at each place, keyed by place id.
    lowAtPlace: { type: Schema.Types.Mixed, required: false },
    active: { type: Boolean, required: false, default: true },
    updatedAt: { type: String, required: true },
  },
  // Keep empty rack and level maps rather than dropping them.
  { versionKey: false, minimize: false },
);

const moveSchema = new Schema(
  {
    id: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    at: { type: String, required: true },
    kind: { type: String, required: true, enum: MOVE_KINDS },
    itemId: { type: String, required: true },
    from: { type: String, required: false },
    to: { type: String, required: false },
    qty: { type: Number, required: true, min: 0 },
    ref: { type: String, required: false, default: '' },
    by: { type: String, required: true },
    note: { type: String, required: false },
  },
  { versionKey: false },
);
moveSchema.index({ itemId: 1, at: -1 });
moveSchema.index({ at: -1 });

const stockSchema = new Schema(
  {
    itemId: { type: String, required: true },
    locationId: { type: String, required: true },
    qty: { type: Number, required: false, default: 0 },
  },
  { versionKey: false },
);
stockSchema.index({ itemId: 1, locationId: 1 }, { unique: true });

/**
 * Whole documents (bills from billing, transfers, orders...). Their shape is checked by the
 * routes with zod before they are written, so the schema only insists on the id.
 */
const docSchema = new Schema({ id: { type: String, required: true, unique: true } }, { versionKey: false, strict: false, minimize: false });
/**
 * The indexes each document collection is read by: bills by time, number and cancelled; transfers
 * and orders by status and time. Built on start by syncIndexes; building one changes no data.
 */
export const DOC_INDEXES: Partial<Record<DocCollection, Record<string, 1 | -1>[]>> = {
  bills: [{ at: -1 }, { no: -1 }, { cancelled: 1, at: -1 }],
  transfers: [{ status: 1, at: -1 }, { at: -1 }],
  pos: [{ status: 1, at: -1 }, { at: -1 }],
  // Deliveries: the admin's live list by status, and each worker's own.
  deliveries: [{ status: 1, at: -1 }, { personId: 1, status: 1 }, { at: -1 }],
};
function docSchemaFor(col: DocCollection): Schema {
  const s = docSchema.clone();
  for (const idx of DOC_INDEXES[col] ?? []) s.index(idx);
  return s;
}
const counterSchema = new Schema({ series: { type: String, required: true, unique: true }, value: { type: Number, required: false, default: 0 } }, { versionKey: false });

export const schemas = {
  Docs: docSchema,
  Counters: counterSchema,
  People: personSchema,
  Locations: locationSchema,
  Items: itemSchema,
  StockMoves: moveSchema,
  Stock: stockSchema,
};

function mongoCond(c: DocCond): unknown {
  if (Array.isArray(c)) return { $in: c };
  if (c === null || typeof c !== 'object') return c;
  const out: Record<string, unknown> = {};
  for (const op of ['gt', 'gte', 'lt', 'lte', 'ne'] as const) if (op in c) out['$' + op] = c[op];
  if (c.exists === true) Object.assign(out, { $exists: true, $ne: null });
  if (c.exists === false) out.$in = [null];
  return out;
}

/** A DocFilter as a Mongo query: equality, one of a list, or a range. */
export function mongoFilter(filter?: DocFilter): Record<string, unknown> {
  if (!filter) return {};
  return Object.fromEntries(Object.entries(filter).map(([k, v]) => [k, mongoCond(v)]));
}

/** Drops Mongo's own fields so what comes out is exactly the shared type. */
function strip<T>(doc: unknown): T {
  const { _id, __v, ...rest } = doc as Record<string, unknown>;
  void _id;
  void __v;
  return rest as T;
}

export async function createMongoRepo(uri: string, dbName: string): Promise<InvRepo> {
  // Its own connection and its own database, so this can share a cluster with the billing app
  // without ever being able to write to the billing app's collections.
  const conn = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 15000 }).asPromise();
  const People = conn.model('People', personSchema, 'people');
  const Locations = conn.model('Locations', locationSchema, 'locations');
  const Items = conn.model('Items', itemSchema, 'items');
  const Moves = conn.model('StockMoves', moveSchema, 'stockmoves');
  const Stock = conn.model('Stock', stockSchema, 'stock');
  const Counters = conn.model('Counters', counterSchema, 'counters');
  const Docs = Object.fromEntries(DOC_COLLECTIONS.map((c) => [c, conn.model('Doc_' + c, docSchemaFor(c), c)])) as unknown as Record<DocCollection, mongoose.Model<{ id: string }>>;
  await Promise.all([
    People.syncIndexes(),
    Locations.syncIndexes(),
    Items.syncIndexes(),
    Moves.syncIndexes(),
    Stock.syncIndexes(),
    Counters.syncIndexes(),
    ...Object.values(Docs).map((m) => m.syncIndexes()),
  ]);

  const isDuplicate = (err: unknown) => (err as { code?: number })?.code === 11000;

  return {
    kind: 'mongo',

    countPeople: () => People.countDocuments(),
    listPeople: async () => (await People.find().lean()).map((d) => strip<PersonRecord>(d)),
    getPerson: async (id) => {
      const d = await People.findOne({ id }).lean();
      return d ? strip<PersonRecord>(d) : null;
    },
    findPersonByPhone: async (phone) => {
      const d = await People.findOne({ phone }).lean();
      return d ? strip<PersonRecord>(d) : null;
    },
    createPerson: async (p) => {
      try {
        await People.create(p);
        return true;
      } catch (err) {
        if (isDuplicate(err)) return false;
        throw err;
      }
    },
    updatePerson: async (id, patch) => {
      const d = await People.findOneAndUpdate({ id }, { $set: patch }, { new: true, runValidators: true }).lean();
      return d ? strip<PersonRecord>(d) : null;
    },

    listLocations: async () => (await Locations.find().lean()).map((d) => strip<Location>(d)),
    saveLocation: async (loc) => {
      await Locations.replaceOne({ id: loc.id }, loc, { upsert: true, runValidators: true });
    },

    listItems: async () => (await Items.find().lean()).map((d) => withLowAt(strip<Item>(d))),
    getItem: async (id) => {
      const d = await Items.findOne({ id }).lean();
      return d ? withLowAt(strip<Item>(d)) : null;
    },
    saveItem: async (item) => {
      await Items.replaceOne({ id: item.id }, item, { upsert: true, runValidators: true });
    },

    insertMove: async (m) => {
      try {
        await Moves.create(m);
        return true;
      } catch (err) {
        if (isDuplicate(err)) return false;
        throw err;
      }
    },
    listMoves: async (q: MoveQuery) => {
      const filter: Record<string, unknown> = {};
      if (q.itemId) filter.itemId = q.itemId;
      if (q.locationId) filter.$or = [{ from: q.locationId }, { to: q.locationId }];
      if (q.from || q.to) filter.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lt: q.to } : {}) };
      let query = Moves.find(filter).sort({ at: -1 });
      if (q.limit) query = query.limit(q.limit);
      return (await query.lean()).map((d) => strip<StockMove>(d));
    },
    ledgerLevels: async (itemIds) => {
      const match = itemIds ? { itemId: { $in: itemIds } } : {};
      const [ins, outs] = await Promise.all([
        Moves.aggregate<{ _id: { i: string; l: string }; q: number }>([
          { $match: { ...match, to: { $exists: true, $ne: null } } },
          { $group: { _id: { i: '$itemId', l: '$to' }, q: { $sum: '$qty' } } },
        ]),
        Moves.aggregate<{ _id: { i: string; l: string }; q: number }>([
          { $match: { ...match, from: { $exists: true, $ne: null } } },
          { $group: { _id: { i: '$itemId', l: '$from' }, q: { $sum: '$qty' } } },
        ]),
      ]);
      const map = new Map<string, StockLevel>();
      const add = (i: string, l: string, d: number) => {
        const k = i + '|' + l;
        const cur = map.get(k) ?? { itemId: i, locationId: l, qty: 0 };
        cur.qty = Math.round((cur.qty + d) * 1000) / 1000;
        map.set(k, cur);
      };
      for (const r of ins) add(r._id.i, r._id.l, r.q);
      for (const r of outs) add(r._id.i, r._id.l, -r.q);
      return [...map.values()];
    },

    listStock: async (itemIds) =>
      (await Stock.find(itemIds ? { itemId: { $in: itemIds } } : {}).lean()).map((d) => strip<StockLevel>(d)),
    incStock: async (itemId, locationId, delta) => {
      await Stock.updateOne({ itemId, locationId }, { $inc: { qty: delta } }, { upsert: true });
    },
    setStock: async (itemId, locationId, qty) => {
      await Stock.updateOne({ itemId, locationId }, { $set: { qty } }, { upsert: true });
    },

    listDocs: async <T>(col: DocCollection, f?: DocFilter | DocQuery) => {
      const q = asQuery(f);
      let query = Docs[col].find(mongoFilter(q.filter), q.fields ? Object.fromEntries(['id', ...q.fields].map((k) => [k, 1])) : undefined);
      if (q.sort) query = query.sort(q.sort);
      if (q.limit) query = query.limit(q.limit);
      return (await query.lean()).map((d) => strip<T>(d));
    },
    getDoc: async <T>(col: DocCollection, id: string) => {
      const d = await Docs[col].findOne({ id }).lean();
      return d ? strip<T>(d) : null;
    },
    putDoc: async (col, doc) => {
      await Docs[col].replaceOne({ id: doc.id }, doc, { upsert: true });
    },
    deleteDoc: async (col, id) => {
      await Docs[col].deleteOne({ id });
    },
    nextNo: async (series) => {
      const d = await Counters.findOneAndUpdate({ series }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean();
      return (d as unknown as { value: number }).value;
    },

    close: () => conn.close(),
  };
}
