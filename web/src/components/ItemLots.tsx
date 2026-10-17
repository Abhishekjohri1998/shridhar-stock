import { describeQty, pickName, type Item, type Location, type Lot } from '@stock/core';
import { http } from '../lib/api';
import { useLive } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { useBi } from './ui';

/** Today in India, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * An item's expiry lots: how much of it expires when, at which place, soonest first. Sales take
 * from the soonest one first. Shows nothing for an item with no lots. Mounted on the item page.
 */
export function ItemLots({ item, locs }: { item: Pick<Item, 'id' | 'units'>; locs: Location[] }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('stock', 'pos');
  const { value } = useLoad(() => http.get<Lot[]>('/admin/items/' + item.id + '/lots'), [item.id, live]);
  if (!value || value.length === 0) return null;
  const now = today();
  const soon = new Date(Date.parse(now + 'T00:00:00Z') + 15 * 86400_000).toISOString().slice(0, 10);
  const place = (id: string) => {
    if (id.startsWith('transit:')) return bi('on the way', 'ದಾರಿಯಲ್ಲಿ');
    const l = locs.find((x) => x.id === id);
    return l ? pickName(l.name, l.nameKn, lang) : id;
  };
  return (
    <div className="card item-lots" data-tour="item-lots">
      <div className="subtitle mt-0">{bi('Expiry dates', 'ಅವಧಿ ಮುಗಿಯುವ ದಿನಗಳು')}</div>
      <ul className="lot-list">
        {value.map((l) => (
          <li key={l.id} className={l.expiry < now ? 'lot-expired' : l.expiry <= soon ? 'lot-soon' : ''}>
            <b>{l.expiry}</b>
            <span>{describeQty(item, l.qty, lang)}</span>
            <span className="muted">{place(l.placeId)}</span>
            {l.expiry < now && <span className="pill bad">{bi('expired', 'ಅವಧಿ ಮುಗಿದಿದೆ')}</span>}
          </li>
        ))}
      </ul>
      <div className="muted">{bi('Sales take from the soonest date first.', 'ಮಾರಾಟ ಬೇಗ ಮುಗಿಯುವುದರಿಂದ ಮೊದಲು ತೆಗೆಯುತ್ತದೆ.')}</div>
    </div>
  );
}
