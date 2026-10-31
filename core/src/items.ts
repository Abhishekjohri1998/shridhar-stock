import { searchKey } from './kannada';
import { round3, round4 } from './money';
import { unitKey } from './units';
import type { Alias, ItemInput, ItemUnit, LowAt, Slab } from './types';

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
      slabs.push({ minQty, rate: round4(rate) });
    }
    slabs.sort((a, b) => a.minQty - b.minQty);

    units.push({
      code,
      label: String(u.label ?? '').trim() || code,
      labelKn: String(u.labelKn ?? '').trim(),
      perBase,
      price: round4(price),
      ...(slabs.length ? { slabs } : {}),
      ...(min != null ? { min: round4(min) } : {}),
      ...(max != null ? { max: round4(max) } : {}),
      ...(cost != null ? { cost: round4(cost) } : {}),
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
  // One running-out level for all places together, in any unit. A screen that still sends the
  // old level per place (an older admin app) has it summed into the base unit.
  let lowAt: LowAt | undefined;
  if (input.lowAt && num(input.lowAt.qty) != null) {
    const n = num(input.lowAt.qty)!;
    if (Number.isNaN(n) || n < 0) return { ok: false, error: 'The running-out level must be 0 or more' };
    const unit = units.find((u) => unitKey(u.code) === unitKey(String(input.lowAt!.unit ?? '') || units[0]!.code));
    if (!unit) return { ok: false, error: 'The running-out level is in a unit the item does not have' };
    lowAt = { qty: round3(n), unit: unit.code };
  } else if (!input.lowAt) {
    let sum: number | undefined;
    for (const level of Object.values(input.reorderAt ?? {})) {
      const n = num(level);
      if (n == null) continue;
      if (Number.isNaN(n) || n < 0) return { ok: false, error: 'The running-out level must be 0 or more' };
      sum = (sum ?? 0) + n;
    }
    if (sum != null) lowAt = { qty: round3(sum), unit: units[0]!.code };
  }

  // Running out at one place, in any of the item's units. A blank one is dropped.
  const lowAtPlace: Record<string, LowAt> = {};
  for (const [loc, l] of Object.entries(input.lowAtPlace ?? {})) {
    if (!l || num(l.qty) == null) continue;
    const n = num(l.qty)!;
    if (Number.isNaN(n) || n < 0) return { ok: false, error: 'The running-out level at a place must be 0 or more' };
    const unit = units.find((u) => unitKey(u.code) === unitKey(String(l.unit ?? '') || units[0]!.code));
    if (!unit) return { ok: false, error: 'The running-out level at a place is in a unit the item does not have' };
    lowAtPlace[loc] = { qty: round3(n), unit: unit.code };
  }

  // A default unit the item does not have is dropped: the item then reads its first unit.
  const du = String(input.defaultUnit ?? '').trim();
  const defaultUnit = du ? units.find((u) => unitKey(u.code) === unitKey(du))?.code : undefined;
  // The same for the unit billing sells in.
  const su = String(input.sellUnit ?? '').trim();
  const sellUnit = su ? units.find((u) => unitKey(u.code) === unitKey(su))?.code : undefined;
  const suppliers: string[] = [];
  for (const s of input.suppliers ?? []) {
    const id = String(s ?? '').trim();
    if (id && id.length <= 60 && !suppliers.includes(id)) suppliers.push(id);
  }
  if (suppliers.length > 20) return { ok: false, error: 'Twenty suppliers at most for one item' };

  return {
    ok: true,
    value: {
      ...(input.id ? { id: input.id } : {}),
      nameEn,
      nameKn,
      ...(String(input.category ?? '').trim() ? { category: String(input.category).trim() } : {}),
      units,
      ...(defaultUnit ? { defaultUnit } : {}),
      ...(sellUnit ? { sellUnit } : {}),
      ...(suppliers.length ? { suppliers } : {}),
      aliases,
      racks,
      ...(lowAt ? { lowAt } : {}),
      ...(Object.keys(lowAtPlace).length ? { lowAtPlace } : {}),
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
 * Invisible characters a phone keyboard can slip into text (the Samsung handwriting pad does):
 * zero-width space / non-joiner / joiner, word joiner, soft hyphen, BOM, bidi marks.
 */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Text as typed, for the plain comparison: no invisible characters, lower case, spaces single. */
export function plainSearchText(text: string): string {
  return String(text ?? '').replace(INVISIBLE, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Whether a typed query finds an item. First plainly: the name or one of its words, in lower case,
 * starts with what was typed ("Nim" finds "Nimraani 5kg", ನಿಮ್ finds ನಿಮ್ರಾನಿ). Then by sound, in either script: the
 * start of any word of any of its names (`akki` finds ಅಕ್ಕಿ and "Sona Masoori rice" alike).
 *
 * The sound key folds an `m` before a consonant into `n` (the anusvara rule), so "Nimraani" keys
 * as `ninrani`; a query that stops on that `m` ("Nim") has no consonant after it yet and keys as
 * `nim`. So a query key ending in `m` is also tried ending in `n`.
 */
export function itemMatches(item: { nameEn: string; nameKn: string; aliases?: Alias[] }, query: string): boolean {
  const plain = plainSearchText(query);
  if (!plain) return false;
  const names = [item.nameEn, item.nameKn, ...(item.aliases ?? []).map((a) => a.text)];
  // Plain first: the start of the name or of any of its words, exactly as typed.
  if (names.some((n) => { const t = plainSearchText(n); return t.startsWith(plain) || t.includes(' ' + plain); })) return true;
  const q = searchKey(plain);
  if (!q) return false;
  const qs = q.endsWith('m') ? [q, q.slice(0, -1) + 'n'] : [q];
  const hit = (k: string) => qs.some((x) => k.startsWith(x));
  for (const name of names) {
    const clean = String(name ?? '').replace(INVISIBLE, '');
    if (hit(searchKey(clean))) return true;
    for (const word of clean.split(/\s+/)) {
      if (hit(searchKey(word))) return true;
    }
  }
  return false;
}

/**
 * The unit of the other name the search reached, when that name has one: "HG box" on an alias
 * {text: 'HG box', unit: 'Box'} answers 'Box'. The search must go past the name's first word (or
 * be the whole of a one-word name), so a bare "HG" still means the item, in its selling unit.
 */
export function matchedAliasUnit(item: { aliases?: Alias[] }, query: string): string | undefined {
  const q = searchKey(query);
  if (!q) return undefined;
  for (const a of item.aliases ?? []) {
    if (!a.unit) continue;
    const whole = searchKey(a.text);
    if (!whole.startsWith(q)) continue;
    const first = searchKey(String(a.text).trim().split(/\s+/)[0] ?? '');
    if (q.length > first.length || q === whole) return a.unit;
  }
  return undefined;
}
