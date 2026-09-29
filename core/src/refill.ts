import type { Item, Location, StockLevel } from './types';

export interface TripLine {
  itemId: string;
  /** What to bring, in base units. */
  qty: number;
  /** What the shop has now, and the level it is running out below. */
  shopQty: number;
  reorderAt: number;
  /** What the godown has. */
  godownQty: number;
}

export interface Trip {
  from: string;
  lines: TripLine[];
}

export interface Refill {
  trips: Trip[];
  /** Low in the shop and no godown has enough: buy from a supplier. `qty` is what is still short. */
  buy: { itemId: string; qty: number; shopQty: number; reorderAt: number }[];
}

/**
 * What to bring to the shop, grouped into one trip per godown.
 *
 * An item is running out when the shop holds less than its level. The shop is topped up to twice
 * the level, taken from whichever godown holds the most of it, and never more than that godown
 * has. Grouping by godown answers "while someone is going there anyway, what else to bring".
 * Whatever no godown can cover is listed to buy.
 */
export function proposeRefill(items: Item[], stock: StockLevel[], locations: Location[]): Refill {
  const shop = locations.find((l) => l.kind === 'shop');
  const godowns = locations.filter((l) => l.kind === 'godown' && l.active);
  const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
  const have = (itemId: string, loc: string) => qty.get(itemId + '|' + loc) ?? 0;
  const trips = new Map<string, TripLine[]>();
  const buy: Refill['buy'] = [];
  if (!shop) return { trips: [], buy };

  for (const item of items) {
    if (!item.active) continue;
    const level = item.reorderAt[shop.id];
    if (level == null) continue;
    const shopQty = have(item.id, shop.id);
    if (shopQty >= level) continue;
    let need = Math.max(0, 2 * level - shopQty);
    const best = godowns
      .map((g) => ({ g, q: have(item.id, g.id) }))
      .filter((x) => x.q > 0)
      .sort((a, b) => b.q - a.q)[0];
    if (best) {
      const take = Math.min(need, best.q);
      const list = trips.get(best.g.id) ?? [];
      list.push({ itemId: item.id, qty: take, shopQty, reorderAt: level, godownQty: best.q });
      trips.set(best.g.id, list);
      need -= take;
    }
    if (need > 0) buy.push({ itemId: item.id, qty: need, shopQty, reorderAt: level });
  }
  return {
    trips: [...trips.entries()].map(([from, lines]) => ({ from, lines })).sort((a, b) => b.lines.length - a.lines.length),
    buy,
  };
}
