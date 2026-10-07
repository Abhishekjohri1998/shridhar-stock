/**
 * The order a worker walks to fetch a bill: the shop's racks first, then each godown's in the
 * order the godowns are listed, racks in their natural order ("Rack 2" before "Rack 10").
 * Anything not on a rack anywhere comes last, in one "other place" group.
 */

export interface PickPlace {
  /** Where the line is kept: the place's name, its position (0 for the shop), and the rack. */
  place?: string;
  placeOrder?: number;
  rack: string;
}

export interface PickGroup<T> {
  key: string;
  place: string;
  rack: string;
  /** True for the last group: lines with no rack in any place. */
  other: boolean;
  lines: T[];
}

export const rackCompare = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export function groupPick<T extends PickPlace>(lines: T[]): PickGroup<T>[] {
  const groups = new Map<string, PickGroup<T> & { order: number }>();
  const rest: T[] = [];
  for (const l of lines) {
    if (!l.rack) {
      rest.push(l);
      continue;
    }
    const key = (l.placeOrder ?? 0) + '|' + l.rack.trim().toLowerCase();
    const g = groups.get(key) ?? { key, place: l.place ?? '', rack: l.rack, other: false, order: l.placeOrder ?? 0, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  const out: PickGroup<T>[] = [...groups.values()]
    .sort((a, b) => a.order - b.order || rackCompare(a.rack, b.rack))
    .map(({ order: _order, ...g }) => g);
  if (rest.length) out.push({ key: 'other', place: '', rack: '', other: true, lines: rest });
  return out;
}

/**
 * The racks already in use at one place, for the rack box to suggest: each once (whatever its
 * case or spaces), blanks left out, in their natural order ("Rack 2" before "Rack 10").
 */
export function rackNames(items: { racks?: Record<string, string> }[], locId: string): string[] {
  const seen = new Map<string, string>();
  for (const it of items) {
    const r = String(it.racks?.[locId] ?? '').trim();
    if (r && !seen.has(r.toLowerCase())) seen.set(r.toLowerCase(), r);
  }
  return [...seen.values()].sort(rackCompare);
}
