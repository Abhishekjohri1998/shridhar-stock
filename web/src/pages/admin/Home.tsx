import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';

export function AdminHome() {
  const { t } = useSession();
  const { value, error } = useLoad(async () => {
    const [items, stock, locs] = await Promise.all([api.items(), api.stock(), api.locations()]);
    const shop = locs.find((l) => l.kind === 'shop');
    const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
    const low = shop
      ? items.filter((i) => {
          const level = i.reorderAt[shop.id];
          return level != null && (qty.get(i.id + '|' + shop.id) ?? 0) < level;
        }).length
      : 0;
    const negative = new Set(stock.filter((s) => s.qty < 0).map((s) => s.itemId)).size;
    return { items: items.length, low, negative, places: locs.length };
  });

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <p className="muted">{t('common.loading')}</p>;
  return (
    <div className="tiles">
      <Link className="tile" to="/admin/items">
        <b>{value.items}</b>
        {t('home.items')}
      </Link>
      <Link className={'tile' + (value.low ? ' warn' : '')} to="/admin/stock?low=1">
        <b>{value.low}</b>
        {t('home.low')}
      </Link>
      <Link className={'tile' + (value.negative ? ' bad' : '')} to="/admin/stock">
        <b>{value.negative}</b>
        {t('home.negative')}
      </Link>
      <Link className="tile" to="/admin/places">
        <b>{value.places}</b>
        {t('home.places')}
      </Link>
    </div>
  );
}
