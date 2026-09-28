/**
 * The shapes the server stores and every screen reads.
 *
 * Quantities of stock are always in the item's base unit (a piece, a kilo, a litre). Every other
 * unit an item is sold in is a whole number of base units, so a box of Parle-G is 144 pieces and
 * there is only ever one number to keep right.
 */

export type Lang = 'en' | 'kn';

export const ROLES = ['admin', 'owner', 'worker', 'godown', 'vendor', 'delivery', 'customer'] as const;
export type Role = (typeof ROLES)[number];

/** A person who signs in. `linkedId` ties a godown person to a place, a vendor to a supplier. */
export interface Person {
  id: string;
  name: string;
  phone: string;
  role: Role;
  linkedId?: string;
  active: boolean;
}

export interface Location {
  id: string;
  name: string;
  nameKn: string;
  /** Exactly one place is the shop. Sales come out of it. */
  kind: 'shop' | 'godown';
  address?: string;
  active: boolean;
}

/** A price that applies from a quantity upwards, in the unit it belongs to. */
export interface Slab {
  minQty: number;
  rate: number;
}

export interface ItemUnit {
  /** The shop's own word for it: 'pc', 'line', 'pack', 'bundle', 'box', 'bag'. Not a fixed list. */
  code: string;
  label: string;
  labelKn: string;
  /** How many base units one of these is. The base unit itself is 1. */
  perBase: number;
  /** The price of one of these. */
  price: number;
  slabs?: Slab[];
  /** The lowest and highest rate the shop will accept for one, when bargaining. */
  min?: number;
  max?: number;
  /** What one costs the shop. Never shown to customers or vendors. */
  cost?: number;
}

/** Another name the item goes by on a bill: "parle", "ಪಾರ್ಲೆ", "parle pack". */
export interface Alias {
  text: string;
  /** The unit this name means, when it means one: "parle pack" is a pack. */
  unit?: string;
}

export interface Item {
  id: string;
  nameEn: string;
  nameKn: string;
  category?: string;
  /** units[0] is the base unit, with perBase 1. */
  units: ItemUnit[];
  aliases: Alias[];
  /** Where it is kept in each place: "Rack 3", "Back room". Keyed by location id. */
  racks: Record<string, string>;
  /** The level, in base units, below which a place is running out. Keyed by location id. */
  reorderAt: Record<string, number>;
  active: boolean;
  updatedAt: string;
}

/** What a screen sends to add or change an item. The server fills in the rest. */
export type ItemInput = Omit<Item, 'id' | 'updatedAt' | 'active'> & { id?: string; active?: boolean };

export const MOVE_KINDS = [
  'open',
  'adjust',
  'sale',
  'cancel',
  'digitise',
  'purchase',
  'transfer_out',
  'transfer_in',
] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

/**
 * One change to stock. The ledger of these is the truth; the per-place numbers are a cache of it.
 *
 * `from` is the place that loses `qty`, `to` the place that gains it. An opening count has only a
 * `to`, a sale only a `from`, a transfer both.
 */
export interface StockMove {
  id: string;
  /** Unique. Posting the same key twice changes nothing, so every posting is safe to retry. */
  key: string;
  at: string;
  kind: MoveKind;
  itemId: string;
  from?: string;
  to?: string;
  /** Always positive, in base units. */
  qty: number;
  /** What caused it: a bill number, a transfer, a reason. */
  ref: string;
  /** The person who did it. */
  by: string;
  note?: string;
}

/** The cached quantity of one item in one place, in base units. */
export interface StockLevel {
  itemId: string;
  locationId: string;
  qty: number;
}

export const ADJUST_REASONS = ['counted', 'damaged', 'expired', 'other'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];
