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
  reorderAt: Record<string, string>;
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
  return { nameEn: '', nameKn: '', category: '', units: [blankUnit(true)], aliases: '', racks: {}, reorderAt: {} };
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
    reorderAt: Object.fromEntries(Object.entries(item.reorderAt).map(([k, v]) => [k, String(v)])),
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
      ...(u.slabs.length ? { slabs: u.slabs.map((x) => ({ minQty: Number(x.minQty), rate: Number(x.rate) })) } : {}),
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
    reorderAt: Object.fromEntries(
      Object.entries(f.reorderAt)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => [k, Number(v)]),
    ),
    ...(active != null ? { active } : {}),
  };
}
