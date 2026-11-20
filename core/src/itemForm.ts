import { searchKey } from './kannada';
import { lowAtOf, lowAtPlaceOf } from './stockTotals';
import { defaultUnitOf, sellUnitOf } from './units';
import { round2, round4 } from './money';
import { slabsFromPacks } from './pricing';
import type { Item, ItemInput } from './types';

/**
 * An item as the editor holds it: every number as the text being typed, so "2." or an empty box
 * is not turned into 2 or 0 mid-keystroke. The website and the admin app share this, so the two
 * editors can never disagree about what a form means.
 */
export interface UnitForm {
  code: string;
  label: string;
  labelKn: string;
  perBase: string;
  price: string;
  min: string;
  max: string;
  cost: string;
  slabs: { minQty: string; rate: string }[];
  /** The barcodes on this unit, as chips. Absent on forms made before barcodes existed. */
  barcodes?: string[];
}

export interface ItemForm {
  nameEn: string;
  nameKn: string;
  category: string;
  units: UnitForm[];
  /** One other name per line, with ", unit" when it means a unit: "parle pack, pack". */
  aliases: string;
  racks: Record<string, string>;
  /** Running out below this many, in all places together, of the unit `lowUnit`. */
  lowQty: string;
  lowUnit: string;
  /** Running out at one place, keyed by place id: the number as typed and its unit. */
  lowPlace: Record<string, { qty: string; unit: string }>;
  /** The unit shown and offered first; empty means the first unit. */
  defaultUnit: string;
  /** The unit billing offers first; empty means the default unit. */
  sellUnit: string;
  /** Supplier ids the shop added by hand. */
  suppliers: string[];
}

/** An empty unit. A new item's base unit starts blank too: no "Piece" the shop did not choose. */
export function blankUnit(base: boolean): UnitForm {
  return {
    code: '',
    label: '',
    labelKn: '',
    perBase: base ? '1' : '',
    price: '',
    min: '',
    max: '',
    cost: '',
    slabs: [],
  };
}

export function blankItemForm(): ItemForm {
  return { nameEn: '', nameKn: '', category: '', units: [blankUnit(true)], aliases: '', racks: {}, lowQty: '', lowUnit: '', lowPlace: {}, defaultUnit: '', sellUnit: '', suppliers: [] };
}

const text = (n: number | undefined) => (n == null ? '' : String(n));
const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

export function itemToForm(item: Item): ItemForm {
  return {
    nameEn: item.nameEn,
    nameKn: item.nameKn,
    category: item.category ?? '',
    units: item.units.map((u) => ({
      code: u.code,
      label: u.label,
      labelKn: u.labelKn,
      perBase: String(u.perBase),
      price: String(u.price),
      min: text(u.min),
      max: text(u.max),
      cost: text(u.cost),
      slabs: (u.slabs ?? []).map((x) => ({ minQty: String(x.minQty), rate: String(x.rate) })),
      barcodes: [...(u.barcodes ?? [])],
    })),
    aliases: item.aliases.map((a) => (a.unit ? a.text + ', ' + a.unit : a.text)).join('\n'),
    racks: { ...item.racks },
    lowQty: text(lowAtOf(item)?.qty),
    lowUnit: lowAtOf(item)?.unit ?? defaultUnitOf(item).code,
    lowPlace: Object.fromEntries(Object.entries(lowAtPlaceOf(item)).map(([loc, l]) => [loc, { qty: String(l.qty), unit: l.unit }])),
    defaultUnit: defaultUnitOf(item).code,
    sellUnit: item.sellUnit ? sellUnitOf(item).code : '',
    suppliers: [...(item.suppliers ?? [])],
  };
}

/** The form as the server wants it. The server checks it again with checkItem. */
export function formToInput(f: ItemForm, active?: boolean): ItemInput {
  return {
    nameEn: f.nameEn,
    nameKn: f.nameKn,
    ...(f.category.trim() ? { category: f.category } : {}),
    units: f.units.map((u, i) => ({
      code: u.code,
      label: u.label,
      labelKn: u.labelKn,
      perBase: i === 0 ? 1 : Number(u.perBase),
      price: u.price.trim() === '' ? NaN : Number(u.price),
      // A slab row left wholly empty is ignored; a half-filled one goes to the server, which says what is missing.
      ...(liveSlabs(u).length ? { slabs: liveSlabs(u).map((x) => ({ minQty: num(x.minQty) ?? NaN, rate: num(x.rate) ?? NaN })) } : {}),
      ...(num(u.min) != null ? { min: num(u.min) } : {}),
      ...(num(u.max) != null ? { max: num(u.max) } : {}),
      ...(num(u.cost) != null ? { cost: num(u.cost) } : {}),
      ...(u.barcodes?.length ? { barcodes: u.barcodes } : {}),
    })),
    aliases: f.aliases
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [t, unit] = line.split(',').map((p) => p.trim());
        return unit ? { text: t!, unit } : { text: t! };
      }),
    racks: f.racks,
    ...(f.defaultUnit.trim() && f.units.some((u) => u.code === f.defaultUnit) ? { defaultUnit: f.defaultUnit } : {}),
    ...(f.sellUnit.trim() && f.units.some((u) => u.code === f.sellUnit) ? { sellUnit: f.sellUnit } : {}),
    ...(f.suppliers.length ? { suppliers: f.suppliers } : {}),
    // A unit that was removed from the item falls back to the base unit.
    ...(f.lowQty.trim() !== ''
      ? { lowAt: { qty: Number(f.lowQty), unit: f.units.some((u) => u.code === f.lowUnit) ? f.lowUnit : f.units[0]?.code ?? '' } }
      : {}),
    ...(Object.values(f.lowPlace).some((l) => l.qty.trim() !== '')
      ? {
          lowAtPlace: Object.fromEntries(
            Object.entries(f.lowPlace)
              .filter(([, l]) => l.qty.trim() !== '')
              .map(([loc, l]) => [loc, { qty: Number(l.qty), unit: f.units.some((u) => u.code === l.unit) ? l.unit : f.units[0]?.code ?? '' }]),
          ),
        }
      : {}),
    ...(active != null ? { active } : {}),
  };
}

const liveSlabs = (u: UnitForm) => u.slabs.filter((x) => x.minQty.trim() !== '' || x.rate.trim() !== '');

/** One "other name" in the item form: the words, and a unit code or '' for any unit. */
export interface AliasChip {
  text: string;
  unit: string;
}

/** Most other names one item may carry in the form. */
export const MAX_ALIASES = 20;

/** The form's newline string of other names as chips. Same reading as formToInput. */
export function aliasChips(s: string): AliasChip[] {
  return s
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [t, unit] = line.split(',').map((p) => p.trim());
      return { text: t ?? '', unit: unit ?? '' };
    })
    .filter((c) => c.text);
}

/** Chips back to the form's newline string: "text" or "text, unit" per line. */
export function aliasesFromChips(chips: AliasChip[]): string {
  return chips.map((c) => (c.unit ? `${c.text}, ${c.unit}` : c.text)).join('\n');
}

/**
 * Adds one name to the chips. Commas are dropped from the name (they split name and unit).
 * Returns the same list when the name is empty, already there (by search key and unit), or the list is full.
 */
export function addAliasChip(chips: AliasChip[], text: string, unit = ''): AliasChip[] {
  const t = text.replace(/[,\n]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || chips.length >= MAX_ALIASES) return chips;
  const k = searchKey(t);
  if (chips.some((c) => searchKey(c.text) === k && c.unit === unit)) return chips;
  return [...chips, { text: t, unit }];
}

/**
 * The form with a name still sitting in the other-names box (typed, "+ Add" not tapped) added
 * to its other names, so Save never drops it. Same rules as addAliasChip; a unit the form no
 * longer has means any unit.
 */
export function withPendingAlias(f: ItemForm, pending: { text: string; unit?: string }): ItemForm {
  if (!pending.text.trim()) return f;
  const unit = pending.unit && f.units.some((u) => u.code === pending.unit) ? pending.unit : '';
  const chips = aliasChips(f.aliases);
  const next = addAliasChip(chips, pending.text, unit);
  return next === chips ? f : { ...f, aliases: aliasesFromChips(next) };
}

/** One row of the "price by pack size" panel, as typed. `unit` is the index of the item unit it came from. */
export interface PackRow {
  size: string;
  price: string;
  from: string;
  unit?: number;
}

const numOf = (v: string): number => (v.trim() === '' ? NaN : Number(v));

/**
 * The pack-size panel's starting rows: one per other unit with a size (perBase) and a price
 * (Kg = 1000 g at ₹55 is size 1000, price 55), then each base-unit slab no unit already covers,
 * as a pack of its quantity at its rate.
 */
export function packsFromItem(f: ItemForm): PackRow[] {
  const rows: PackRow[] = [];
  f.units.forEach((u, i) => {
    if (i === 0) return;
    const size = numOf(u.perBase);
    const price = numOf(u.price);
    if (u.code.trim() && size > 0 && price >= 0) rows.push({ size: String(size), price: String(price), from: '', unit: i });
  });
  for (const sl of f.units[0]?.slabs ?? []) {
    const minQty = numOf(sl.minQty);
    const rate = numOf(sl.rate);
    if (!(minQty > 0 && rate >= 0)) continue;
    if (rows.some((r) => Number(r.size) === minQty)) continue;
    rows.push({ size: String(minQty), price: String(round2(minQty * rate)), from: '' });
  }
  return rows.sort((a, b) => Number(a.size) - Number(b.size));
}

/**
 * The form with the pack rows applied: the base unit's price is the smallest pack's rate and its
 * slabs one per other pack; a row from a unit also sets that unit's price. Null when no row is usable.
 */
export function applyPacks(f: ItemForm, rows: PackRow[]): ItemForm | null {
  const r = slabsFromPacks(rows.map((x) => ({ size: numOf(x.size), price: numOf(x.price), ...(x.from.trim() ? { from: numOf(x.from) } : {}) })));
  if (!r) return null;
  const units = f.units.map((u, i) => {
    if (i === 0) return { ...u, price: String(r.price), slabs: r.slabs.map((x) => ({ minQty: String(x.minQty), rate: String(x.rate) })) };
    const row = rows.find((x) => x.unit === i);
    const price = row ? numOf(row.price) : NaN;
    return row && price >= 0 ? { ...u, price: row.price.trim() } : u;
  });
  return { ...f, units };
}

/**
 * Every unit's cost worked out from one unit's cost, usually the biggest one bought:
 * a 50 kg Bag (50000 g) at ₹2700 gives 0.054 a g (round4), then 250 g 13.5, 1 kg 54 (round2).
 * Null when that unit has no usable cost or size. The chosen unit keeps its cost as typed.
 */
export function costsFromUnit(f: ItemForm, unitIndex: number): ItemForm | null {
  const from = f.units[unitIndex];
  if (!from) return null;
  const cost = numOf(from.cost);
  const size = unitIndex === 0 ? 1 : numOf(from.perBase);
  if (!(cost >= 0) || !(size > 0)) return null;
  const perBase = round4(cost / size);
  const units = f.units.map((u, i) => {
    if (i === unitIndex) return u;
    if (i === 0) return { ...u, cost: String(perBase) };
    const n = numOf(u.perBase);
    return n > 0 ? { ...u, cost: String(round2((cost / size) * n)) } : u;
  });
  return { ...f, units };
}

/** The unit with the most base units in it (index), for the cost helper's first choice. */
export function biggestUnitIndex(f: ItemForm): number {
  let best = 0;
  let bestSize = 1;
  f.units.forEach((u, i) => {
    const n = i === 0 ? 1 : numOf(u.perBase);
    if (n > bestSize) { best = i; bestSize = n; }
  });
  return best;
}

/**
 * A suggested price (or cost) for every unit, each from the next bigger unit that has one.
 *
 * Each unit takes its rate from the smallest priced unit bigger than itself, so smaller packs
 * follow the retail price next above them, not the wholesale bag. Sugar: Bag of 50000 g at ₹2850
 * is ₹0.057 a g, so 1 kg suggests ₹57. Type 58 for the kg and 500 g follows the kg (₹0.058 a g)
 * and suggests ₹29; type 30 for the 500 g and 250 g follows that and suggests ₹15. With 1 kg at
 * ₹130 beside a 30 kg bag at ₹2500, 500 g suggests ₹65, never the bag's ₹41.67.
 *
 * A unit with nothing bigger priced takes the nearest smaller priced unit instead, but only while
 * its own box is empty: the biggest pack's price is the shop's own, not something to work out
 * from a loose one. A unit whose typed value already matches gets no suggestion; one that
 * differs still shows what its bigger unit would make it, so the two can be compared. Nothing
 * is ever filled in without the shopkeeper tapping Use.
 */
export interface UnitSuggestions {
  /** Per unit: the suggested value (round2), or null when there is nothing to suggest. */
  suggest: (number | null)[];
  /** Per unit: the rate per base unit the suggestion came from (round4), or null. */
  rate: (number | null)[];
  /** Per unit: the index of the unit the rate came from, or null. */
  from: (number | null)[];
}

const sizeOf = (f: ItemForm, i: number) => (i === 0 ? 1 : numOf(f.units[i]?.perBase ?? ''));

export function unitSuggestions(f: ItemForm, field: 'price' | 'cost' = 'price'): UnitSuggestions {
  const value = (i: number) => numOf(f.units[i]![field]);
  const priced = f.units
    .map((_, i) => i)
    // ₹0 is a unit nobody has priced yet (a saved item needs a number there), never a reference.
    .filter((i) => value(i) > 0 && sizeOf(f, i) > 0);
  const out: UnitSuggestions = { suggest: [], rate: [], from: [] };
  f.units.forEach((u, i) => {
    const n = sizeOf(f, i);
    let src: number | null = null;
    if (n > 0) {
      // The smallest priced unit bigger than this one.
      for (const j of priced) {
        if (j !== i && sizeOf(f, j) > n && (src == null || sizeOf(f, j) < sizeOf(f, src))) src = j;
      }
      // Nothing bigger priced: the biggest priced unit smaller than this one, for an empty box.
      if (src == null && !(value(i) > 0)) {
        for (const j of priced) {
          if (j !== i && sizeOf(f, j) < n && (src == null || sizeOf(f, j) > sizeOf(f, src))) src = j;
        }
      }
    }
    const rate = src == null ? null : value(src) / sizeOf(f, src);
    let v = rate == null ? null : round2(n * rate);
    // Already at that price: nothing to say.
    if (v != null && value(i) > 0 && Math.abs(value(i) - v) < 0.005) v = null;
    out.suggest.push(v);
    out.rate.push(v == null || rate == null ? null : round4(rate));
    out.from.push(v == null ? null : src);
  });
  return out;
}

/**
 * A unit whose size changed in the editor: a Box was 60 pc and is now 72. Stock is kept in base
 * units, so nothing moves; this only says what the same stock now reads as. Null when the unit is
 * new, unchanged, or the new size is not a number yet.
 */
export interface PackChange {
  code: string;
  was: number;
  now: number;
  /** Stock in base units, when known, and how many of the unit it made before and makes now. */
  stock?: number;
  wasPacks?: number;
  nowPacks?: number;
}

export function packChange(item: Pick<Item, 'units'> | null, u: UnitForm, totalBase?: number): PackChange | null {
  if (!item || !u.code.trim()) return null;
  const old = item.units.find((x) => x.code === u.code);
  const now = numOf(u.perBase);
  if (!old || !(now > 0) || old.perBase === now) return null;
  const out: PackChange = { code: u.code, was: old.perBase, now };
  if (totalBase != null && Number.isFinite(totalBase)) {
    out.stock = totalBase;
    out.wasPacks = round2(totalBase / old.perBase);
    out.nowPacks = round2(totalBase / now);
  }
  return out;
}
