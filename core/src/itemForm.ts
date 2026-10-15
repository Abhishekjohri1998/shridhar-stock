import { searchKey } from './kannada';
import { lowAtOf, lowAtPlaceOf } from './stockTotals';
import { defaultUnitOf, sellUnitOf } from './units';
import { round2 } from './money';
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

export function blankUnit(base: boolean): UnitForm {
  return {
    code: base ? 'pc' : '',
    label: base ? 'Piece' : '',
    labelKn: base ? 'ಪೀಸ್' : '',
    perBase: base ? '1' : '',
    price: '',
    min: '',
    max: '',
    cost: '',
    slabs: [],
  };
}

export function blankItemForm(): ItemForm {
  return { nameEn: '', nameKn: '', category: '', units: [blankUnit(true)], aliases: '', racks: {}, lowQty: '', lowUnit: 'pc', lowPlace: {}, defaultUnit: '', sellUnit: '', suppliers: [] };
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
