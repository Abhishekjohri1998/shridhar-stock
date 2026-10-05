import { lowAtOf } from './stockTotals';
import { defaultUnitOf } from './units';
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
  /** The unit shown and offered first; empty means the first unit. */
  defaultUnit: string;
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
  return { nameEn: '', nameKn: '', category: '', units: [blankUnit(true)], aliases: '', racks: {}, lowQty: '', lowUnit: 'pc', defaultUnit: '', suppliers: [] };
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
    defaultUnit: defaultUnitOf(item).code,
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
    ...(f.suppliers.length ? { suppliers: f.suppliers } : {}),
    // A unit that was removed from the item falls back to the base unit.
    ...(f.lowQty.trim() !== ''
      ? { lowAt: { qty: Number(f.lowQty), unit: f.units.some((u) => u.code === f.lowUnit) ? f.lowUnit : f.units[0]?.code ?? '' } }
      : {}),
    ...(active != null ? { active } : {}),
  };
}

const liveSlabs = (u: UnitForm) => u.slabs.filter((x) => x.minQty.trim() !== '' || x.rate.trim() !== '');
