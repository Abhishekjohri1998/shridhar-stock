import { parseCsv, toCsv, unguard } from './csv';
import { unitKey } from './units';
import type { Alias, Item, ItemInput, ItemUnit, Slab } from './types';

/**
 * The items spreadsheet: one row per unit, so an item sold three ways is three rows sharing an
 * item_id. The shop can type a whole catalogue in Excel and bring it in at once.
 *
 * The first row of an item is its base unit. Racks and running-out levels are for the shop and
 * are read from that first row.
 */
export const ITEM_COLUMNS = [
  'item_id',
  'name_en',
  'name_kn',
  'category',
  'unit_code',
  'unit_label',
  'unit_label_kn',
  'per_base',
  'price',
  'min',
  'max',
  'cost',
  'slabs',
  'other_names',
  'rack_shop',
  'reorder_shop',
  'active',
] as const;

/** "5:28|10:26" is 5 or more at 28, 10 or more at 26. */
export function slabsToText(slabs: Slab[] | undefined): string {
  return (slabs ?? []).map((s) => s.minQty + ':' + s.rate).join('|');
}

export function slabsFromText(text: string): Slab[] | string {
  const out: Slab[] = [];
  for (const part of text.split('|').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([\d.]+)\s*:\s*([\d.]+)$/.exec(part);
    if (!m) return 'a slab should look like 5:28 (from 5, at 28), not "' + part + '"';
    out.push({ minQty: Number(m[1]), rate: Number(m[2]) });
  }
  return out;
}

export function itemsToCsv(items: Item[], shopId: string): string {
  const rows: (string | number | undefined)[][] = [];
  for (const it of items) {
    it.units.forEach((u, i) => {
      const names = it.aliases
        .filter((a) => (a.unit ? unitKey(a.unit) === unitKey(u.code) : i === 0))
        .map((a) => a.text)
        .join('|');
      rows.push([
        it.id,
        i === 0 ? it.nameEn : '',
        i === 0 ? it.nameKn : '',
        i === 0 ? it.category ?? '' : '',
        u.code,
        u.label,
        u.labelKn,
        u.perBase,
        u.price,
        u.min,
        u.max,
        u.cost,
        slabsToText(u.slabs),
        names,
        i === 0 ? it.racks[shopId] ?? '' : '',
        i === 0 ? it.reorderAt[shopId] : undefined,
        i === 0 ? (it.active ? 'yes' : 'no') : '',
      ]);
    });
  }
  return toCsv([...ITEM_COLUMNS], rows);
}

export interface ItemsCsvResult {
  items: ItemInput[];
  /** The spreadsheet row each item starts on, alongside `items`. */
  rows: number[];
  errors: { row: number; message: string }[];
}

/**
 * Reads the items spreadsheet back. Rows are grouped into items by item_id, or, for new items
 * with no id yet, by the row that carries a name: every row after it without a name is another
 * unit of the same item.
 *
 * Errors carry the spreadsheet's own row number (the header is row 1) so the shop can find them.
 */
export function itemsFromCsv(text: string, shopId: string): ItemsCsvResult {
  const rows = parseCsv(text);
  const errors: ItemsCsvResult['errors'] = [];
  if (rows.length === 0) return { items: [], rows: [], errors: [{ row: 1, message: 'The file is empty' }] };

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const need of ['unit_code', 'price']) {
    if (col(need) < 0) return { items: [], rows: [], errors: [{ row: 1, message: 'The column "' + need + '" is missing' }] };
  }
  if (col('name_en') < 0 && col('name_kn') < 0) {
    return { items: [], rows: [], errors: [{ row: 1, message: 'Need a name_en or name_kn column' }] };
  }

  const items: ItemInput[] = [];
  const itemRows: number[] = [];
  const byId = new Map<string, ItemInput>();
  let current: ItemInput | null = null;

  rows.slice(1).forEach((r, idx) => {
    const rowNo = idx + 2;
    const get = (name: string) => {
      const i = col(name);
      return i < 0 ? '' : unguard(String(r[i] ?? '').trim());
    };
    const id = get('item_id');
    const nameEn = get('name_en');
    const nameKn = get('name_kn');

    let item: ItemInput | null = null;
    if (id && byId.has(id)) item = byId.get(id)!;
    else if (nameEn || nameKn) {
      item = {
        ...(id ? { id } : {}),
        nameEn,
        nameKn,
        ...(get('category') ? { category: get('category') } : {}),
        units: [],
        aliases: [],
        racks: get('rack_shop') ? { [shopId]: get('rack_shop') } : {},
        reorderAt: get('reorder_shop') ? { [shopId]: Number(get('reorder_shop')) } : {},
        ...(get('active') ? { active: !/^(no|n|0|false)$/i.test(get('active')) } : {}),
      };
      items.push(item);
      itemRows.push(rowNo);
      if (id) byId.set(id, item);
    } else if (!id && current) item = current;

    if (!item) {
      errors.push({ row: rowNo, message: 'This row has no item name and does not follow one' });
      return;
    }
    current = item;

    const code = get('unit_code');
    if (!code) {
      errors.push({ row: rowNo, message: 'unit_code is empty' });
      return;
    }
    const slabs = slabsFromText(get('slabs'));
    if (typeof slabs === 'string') {
      errors.push({ row: rowNo, message: slabs });
      return;
    }
    const numOr = (name: string): number | undefined => (get(name) === '' ? undefined : Number(get(name).replace(/[,₹\s]/g, '')));
    const unit: ItemUnit = {
      code,
      label: get('unit_label') || code,
      labelKn: get('unit_label_kn'),
      perBase: item.units.length === 0 ? 1 : Number(get('per_base') || NaN),
      price: numOr('price') ?? NaN,
      ...(slabs.length ? { slabs } : {}),
      ...(numOr('min') != null ? { min: numOr('min') } : {}),
      ...(numOr('max') != null ? { max: numOr('max') } : {}),
      ...(numOr('cost') != null ? { cost: numOr('cost') } : {}),
    };
    item.units.push(unit);
    const first = item.units.length === 1;
    for (const text of get('other_names').split('|').map((t) => t.trim()).filter(Boolean)) {
      const alias: Alias = first ? { text } : { text, unit: code };
      item.aliases.push(alias);
    }
  });

  return { items, rows: itemRows, errors };
}
