import { searchKey } from './kannada';
import { round2 } from './money';
import { unitKey } from './units';
import type { Alias, ItemInput, ItemUnit, Slab } from './types';

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const num = (v: unknown): number | undefined => {
  if (v === '' || v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Tidies and checks an item before it is saved. The server runs this on every write, so a rule
 * here cannot be skipped by a screen that forgets it.
 */
export function checkItem(input: ItemInput): Checked<ItemInput> {
  const nameEn = String(input.nameEn ?? '').trim();
  const nameKn = String(input.nameKn ?? '').trim();
  if (!nameEn && !nameKn) return { ok: false, error: 'Give the item a name, in English or Kannada' };
  if (nameEn.length > 80 || nameKn.length > 80) return { ok: false, error: 'The name is too long (80 letters at most)' };

  const rawUnits = input.units ?? [];
  if (rawUnits.length === 0) return { ok: false, error: 'An item needs its base unit, such as pc or kg' };
  if (rawUnits.length > 8) return { ok: false, error: 'Eight units at most' };

  const units: ItemUnit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawUnits.length; i++) {
    const u = rawUnits[i]!;
    const code = String(u.code ?? '').trim();
    const where = 'Unit ' + (code || i + 1) + ': ';
    if (!code) return { ok: false, error: 'Unit ' + (i + 1) + ' needs a short name, such as pc, pack or box' };
    if (code.length > 16) return { ok: false, error: where + 'the short name is too long' };
    if (seen.has(unitKey(code))) return { ok: false, error: 'The unit "' + code + '" is listed twice' };
    seen.add(unitKey(code));

    const perBase = i === 0 ? 1 : num(u.perBase);
    if (i === 0 && u.perBase != null && Number(u.perBase) !== 1) {
      return { ok: false, error: where + 'the first unit is the base unit, so it is 1 of itself' };
    }
    if (perBase == null || !Number.isInteger(perBase) || perBase < 1) {
      return { ok: false, error: where + 'how many base units it holds must be a whole number, 1 or more' };
    }
    const price = num(u.price);
    if (price == null || Number.isNaN(price) || price < 0) return { ok: false, error: where + 'give a price, 0 or more' };
    const min = num(u.min);
    const max = num(u.max);
    const cost = num(u.cost);
    if (Number.isNaN(min) || (min != null && min < 0)) return { ok: false, error: where + 'the lowest rate is not a number' };
    if (Number.isNaN(max) || (max != null && max < 0)) return { ok: false, error: where + 'the highest rate is not a number' };
    if (min != null && max != null && min > max) return { ok: false, error: where + 'the lowest rate is above the highest' };
    if (Number.isNaN(cost) || (cost != null && cost < 0)) return { ok: false, error: where + 'the cost is not a number' };

    const slabs: Slab[] = [];
    for (const s of u.slabs ?? []) {
      const minQty = num(s.minQty);
      const rate = num(s.rate);
      if (minQty == null || Number.isNaN(minQty) || minQty <= 0) return { ok: false, error: where + 'a price slab needs a quantity above 0' };
      if (rate == null || Number.isNaN(rate) || rate < 0) return { ok: false, error: where + 'a price slab needs a rate' };
      if (slabs.some((x) => x.minQty === minQty)) return { ok: false, error: where + 'two slabs start at ' + minQty };
      slabs.push({ minQty, rate: round2(rate) });
    }
    slabs.sort((a, b) => a.minQty - b.minQty);

    units.push({
      code,
      label: String(u.label ?? '').trim() || code,
      labelKn: String(u.labelKn ?? '').trim(),
      perBase,
      price: round2(price),
      ...(slabs.length ? { slabs } : {}),
      ...(min != null ? { min: round2(min) } : {}),
      ...(max != null ? { max: round2(max) } : {}),
      ...(cost != null ? { cost: round2(cost) } : {}),
    });
  }

  const aliases: Alias[] = [];
  const aliasKeys = new Set<string>();
  for (const a of input.aliases ?? []) {
    const text = String(a.text ?? '').trim();
    if (!text) continue;
    const unit = a.unit ? String(a.unit).trim() : '';
    if (unit && !seen.has(unitKey(unit))) return { ok: false, error: 'The other name "' + text + '" points at a unit the item does not have' };
    const k = searchKey(text) + '|' + unitKey(unit);
    if (aliasKeys.has(k)) continue;
    aliasKeys.add(k);
    aliases.push(unit ? { text, unit } : { text });
  }
  if (aliases.length > 20) return { ok: false, error: 'Twenty other names at most' };

  const racks: Record<string, string> = {};
  for (const [loc, rack] of Object.entries(input.racks ?? {})) {
    const r = String(rack ?? '').trim();
    if (r) racks[loc] = r.slice(0, 40);
  }
  const reorderAt: Record<string, number> = {};
  for (const [loc, level] of Object.entries(input.reorderAt ?? {})) {
    const n = num(level);
    if (n == null) continue;
    if (Number.isNaN(n) || n < 0) return { ok: false, error: 'The running-out level must be 0 or more' };
    reorderAt[loc] = n;
  }

  return {
    ok: true,
    value: {
      ...(input.id ? { id: input.id } : {}),
      nameEn,
      nameKn,
      ...(String(input.category ?? '').trim() ? { category: String(input.category).trim() } : {}),
      units,
      aliases,
      racks,
      reorderAt,
      ...(input.active != null ? { active: !!input.active } : {}),
    },
  };
}

/** Everything an item can be found by, as search keys. */
export function itemKeys(item: { nameEn: string; nameKn: string; aliases?: Alias[] }): string[] {
  const keys = [item.nameEn, item.nameKn, ...(item.aliases ?? []).map((a) => a.text)]
    .map((t) => searchKey(t))
    .filter(Boolean);
  return [...new Set(keys)];
}

/**
 * Whether a typed query finds an item: the start of any word of any of its names, in either
 * script. `akki` finds ಅಕ್ಕಿ and "Sona Masoori rice" alike; `ice` finds neither.
 */
export function itemMatches(item: { nameEn: string; nameKn: string; aliases?: Alias[] }, query: string): boolean {
  const q = searchKey(query);
  if (!q) return false;
  const names = [item.nameEn, item.nameKn, ...(item.aliases ?? []).map((a) => a.text)];
  for (const name of names) {
    const whole = searchKey(name);
    if (whole.startsWith(q)) return true;
    for (const word of String(name).split(/\s+/)) {
      if (searchKey(word).startsWith(q)) return true;
    }
  }
  return false;
}
