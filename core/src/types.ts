/**
 * The shapes the server stores and every screen reads.
 *
 * Quantities of stock are always in the item's base unit (a piece, a kilo, a litre). Every other
 * unit an item is sold in is a whole number of base units, so a box of Parle-G is 144 pieces and
 * there is only ever one number to keep right.
 */

export type Lang = 'en' | 'kn';

export const ROLES = ['admin', 'owner', 'worker', 'godown', 'vendor', 'delivery', 'customer'] as const;
/** The roles that still sign in. The others are kept only so old records read. */
export const ACTIVE_ROLES = ['admin', 'worker', 'godown'] as const satisfies readonly Role[];
export type ActiveRole = (typeof ACTIVE_ROLES)[number];
export type Role = (typeof ROLES)[number];

/**
 * A person who signs in. `linkedId` ties a godown person to a place. The vendor role is kept so old
 * records still read, but a vendor no longer signs in: suppliers are contacts under Purchases.
 */
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

/** A quantity in one of an item's units, as the shop typed it. */
export interface LowAt {
  qty: number;
  unit: string;
}

export interface Item {
  id: string;
  nameEn: string;
  nameKn: string;
  category?: string;
  /** units[0] is the base unit, with perBase 1. */
  units: ItemUnit[];
  /**
   * The unit stock is shown, counted, moved and bought in by default, and the first one billing
   * offers. Absent on older items, which read it as their first unit (`defaultUnitOf`).
   */
  defaultUnit?: string;
  /** Suppliers the shop added by hand as ones who supply this item (supplier ids). Purchase orders add more when read. */
  suppliers?: string[];
  aliases: Alias[];
  /** Where it is kept in each place: "Rack 3", "Back room". Keyed by location id. */
  racks: Record<string, string>;
  /**
   * Running out below this, in all places together, in any of the item's units: "5 box". null
   * when the shop cleared it on an item that still carries old per-place levels.
   */
  lowAt?: LowAt | null;
  /**
   * The old level per place, in base units, kept as it was saved. Read only through `lowAtOf`,
   * which sums it when the item has no `lowAt` yet. New saves do not write it.
   */
  reorderAt?: Record<string, number>;
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

// ------------------------------------------------------------------ handwriting

/** Pen strokes, in the billing app's own format: each stroke is [x0, y0, x1, y1, ...]. */
export interface Ink {
  w: number;
  h: number;
  strokes: number[][];
}

/** What the handwriting reader made of one written line. */
export interface Reading {
  /** The words as read, in the script they were written in. */
  readText: string;
  itemId?: string;
  unit?: string;
  qty?: number;
  /** 0 to 1: how sure the reader is that it is this item. */
  confidence: number;
  alternatives: { itemId: string; confidence: number }[];
  /** 'reader' for the machine, or the person who confirmed it. */
  by: string;
  at: string;
}

// ------------------------------------------------------------------ bills, from billing

/**
 * How a bill line was turned into stock:
 * - typed-match: typed, and matched one item by name
 * - read-auto: handwritten, and the reader was sure
 * - to-confirm: waiting for a person (unsure reading, no match, or no reader)
 * - confirmed: a person chose the item
 * - not-item: a person said it is not stock (a service, a note)
 */
export type LineState = 'typed-match' | 'read-auto' | 'to-confirm' | 'confirmed' | 'not-item';

export interface MirrorLine {
  i: number;
  /** The typed name, empty when the line is handwritten only. */
  name: string;
  ink?: Ink;
  qty: number;
  rate: number;
  amount: number;
  state: LineState;
  itemId?: string;
  unit?: string;
  baseQty?: number;
  reading?: Reading;
  /** The worker's tick: brought from the rack. */
  fetched?: boolean;
  /** Billing's given tick as the last sync saw it: a change there is adopted as the fetched tick. */
  billingGiven?: boolean;
}

/** A bill as read from the billing server. Stock never writes to billing. */
export interface BillMirror {
  id: string;
  no: number;
  at: string;
  customer?: { key: string; name: string; phone: string };
  lines: MirrorLine[];
  total: number;
  paid: number;
  balance: number;
  cancelled?: boolean;
}

/** A customer, from billing, plus what deliveries need that billing does not keep. */
export interface CustomerProfile {
  id: string;
  /** The phone number, which is what ties a customer's login to their bills. */
  key: string;
  name: string;
  nameKn?: string;
  address?: string;
  landmark?: string;
  balance: number;
  /** Billing's id for this customer, so an address set here can be sent back to billing. */
  billingId?: string;
}

// ------------------------------------------------------------------ movement between places

export type TransferStatus = 'requested' | 'sent' | 'received' | 'cancelled';

export interface TransferLine {
  itemId: string;
  /** Asked for, in base units. */
  qty: number;
  sent?: number;
  received?: number;
}

export interface Transfer {
  id: string;
  no: number;
  from: string;
  to: string;
  lines: TransferLine[];
  status: TransferStatus;
  vehicle?: string;
  driver?: string;
  note?: string;
  noteInk?: Ink;
  at: string;
  times: Partial<Record<TransferStatus, string>>;
}

// ------------------------------------------------------------------ buying

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address?: string;
  /** Anything the shop wants to remember: what they supply, when they come. */
  notes?: string;
  active: boolean;
}

/**
 * Ordered, then received or cancelled. 'confirmed' and 'dispatched' were the vendor's steps when
 * vendors signed in; orders saved in those states are still open and show as ordered.
 */
export type POStatus = 'ordered' | 'confirmed' | 'dispatched' | 'received' | 'cancelled';

/** The states of an order still waiting for its goods. */
export const OPEN_PO = ['ordered', 'confirmed', 'dispatched'] as const;

/** What an order shows as: every open state is simply "ordered". */
export function poStage(status: POStatus): 'ordered' | 'received' | 'cancelled' {
  return status === 'received' || status === 'cancelled' ? status : 'ordered';
}

export interface POLine {
  itemId: string;
  unit: string;
  qty: number;
  /** Cost per unit. The vendor sees this; they never see the shop's sale price. */
  cost: number;
}

export interface PurchaseOrder {
  id: string;
  no: number;
  supplierId: string;
  to: string;
  lines: POLine[];
  status: POStatus;
  invoiceNo?: string;
  vehicle?: string;
  eta?: string;
  at: string;
  times: Partial<Record<POStatus, string>>;
}

// ------------------------------------------------------------------ deliveries and orders (old records only: these features were removed)

export type DeliveryStatus = 'pending' | 'out' | 'delivered' | 'failed';

export interface Delivery {
  id: string;
  billNo: number;
  customerKey: string;
  name: string;
  phone: string;
  address: string;
  landmark?: string;
  personId?: string;
  vehicle?: string;
  status: DeliveryStatus;
  amountDue: number;
  note?: string;
  at: string;
  times: Partial<Record<DeliveryStatus, string>>;
}

export interface OrderLine {
  text?: string;
  ink?: Ink;
  itemId?: string;
  unit?: string;
  qty?: number;
}

export interface OrderRequest {
  id: string;
  personId: string;
  customerKey: string;
  lines: OrderLine[];
  note?: string;
  status: 'new' | 'done' | 'declined';
  billNo?: number;
  at: string;
}

// ------------------------------------------------------------------ vehicles and settings

/** A vehicle the shop uses for transfers and deliveries. Forms offer these but take any text. */
export interface Vehicle {
  id: string;
  /** The registration, "KA-17 AB 1234", or a plain name for a cycle. */
  number: string;
  /** Tempo, auto, scooter: the shop's own word. */
  type: string;
  driverName: string;
  driverPhone: string;
  active: boolean;
}

/** The shop's own settings, kept by the admin. */
export interface ShopSettings {
  /** Bills are rounded to the nearest this many rupees; 0 for no rounding. */
  roundTo: 0 | 1 | 5 | 10;
}

export const DEFAULT_SETTINGS: ShopSettings = { roundTo: 0 };
