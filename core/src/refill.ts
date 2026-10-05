import { lowBase, totalsByItem } from './stockTotals';
import type { Item, Location, StockLevel } from './types';

export interface TripLine {
  itemId: string;
  /** What to bring, in base units. */
  qty: number;
  /** What the shop has now, and the shelf level it is short of. */
  shopQty: number;
  level: number;
  /** What the godown has. */
  godownQty: number;
}

export interface Trip {
  from: string;
  lines: TripLine[];
}

export interface Refill {
  trips: Trip[];
  /** Low in all places together: buy from a supplier. `qty` tops the total up to twice the level. */
  buy: { itemId: string; qty: number; total: number; shopQty: number; level: number }[];
}

/**
 * What to bring to the shop, grouped into one trip per godown, and what to buy.
 *
 * The shop's shelf is short when it holds less than the item's running-out level (`lowAt`, in
 * base units). It is topped up to twice the level, from whichever godown holds the most, and never
 * more than that godown has. Grouping by godown answers "while someone is going there anyway,
 * what else to bring".
 *
 * Buying is a different question: an item goes on the buy list when the shop and every godown
 * together hold less than its level, whatever any one shelf looks like.
 */
export function proposeRefill(items: Item[], stock: StockLevel[], locations: Location[]): Refill {
  const shop = locations.find((l) => l.kind === 'shop');
  const godowns = locations.filter((l) => l.kind === 'godown' && l.active);
  const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
  const have = (itemId: string, loc: string) => qty.get(itemId + '|' + loc) ?? 0;
  const totals = totalsByItem(stock);
  const trips = new Map<string, TripLine[]>();
  const buy: Refill['buy'] = [];
  if (!shop) return { trips: [], buy };

  for (const item of items) {
    if (!item.active) continue;
    const level = lowBase(item);
    if (level == null) continue;
    const shopQty = have(item.id, shop.id);
    if (shopQty < level) {
      const need = Math.max(0, 2 * level - shopQty);
      const best = godowns
        .map((g) => ({ g, q: have(item.id, g.id) }))
        .filter((x) => x.q > 0)
        .sort((a, b) => b.q - a.q)[0];
      if (best) {
        const list = trips.get(best.g.id) ?? [];
        list.push({ itemId: item.id, qty: Math.min(need, best.q), shopQty, level, godownQty: best.q });
        trips.set(best.g.id, list);
      }
    }
    const total = totals.get(item.id) ?? 0;
    if (total < level) buy.push({ itemId: item.id, qty: Math.max(0, 2 * level - total), total, shopQty, level });
  }
  return {
    trips: [...trips.entries()].map(([from, lines]) => ({ from, lines })).sort((a, b) => b.lines.length - a.lines.length),
    buy,
  };
}
