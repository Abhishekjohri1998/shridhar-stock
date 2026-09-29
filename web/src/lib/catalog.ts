import { useEffect, useState } from 'react';
import { describeQty, pickName, type Item, type Lang, type Location } from '@stock/core';
import { api } from './api';

/** Items and places, for the admin and owner screens that show names next to ids. */
export function useCatalog(version = 0) {
  const [items, setItems] = useState<Map<string, Item>>(new Map());
  const [locs, setLocs] = useState<Location[]>([]);
  useEffect(() => {
    api.items(true).then((list) => setItems(new Map(list.map((i) => [i.id, i])))).catch(() => undefined);
    api.locations().then(setLocs).catch(() => undefined);
  }, [version]);
  return { items, locs };
}

export function itemName(items: Map<string, Item>, id: string | undefined, lang: Lang): string {
  const it = id ? items.get(id) : undefined;
  return it ? pickName(it.nameEn, it.nameKn, lang) : id ?? '';
}

export function placeName(locs: Location[], id: string, lang: Lang): string {
  const l = locs.find((x) => x.id === id);
  return l ? pickName(l.name, l.nameKn, lang) : id;
}

export function qtyText(items: Map<string, Item>, id: string, baseQty: number, lang: Lang): string {
  const it = items.get(id);
  return it ? describeQty(it, baseQty, lang) : String(baseQty);
}
