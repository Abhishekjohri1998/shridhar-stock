import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { describeQty, isLow, itemMatches, lowAtOf, pickName, totalsByItem, type Item, type Lang, type Location, type StockLevel } from '@stock/core';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Loading, Table, useBi } from '../../components/ui';

/** "5 box", the way the running-out level was typed, in the shop's words. */
export function lowWords(item: Item, lang: Lang): string {
  const l = lowAtOf(item);
  if (!l) return '';
  const u = item.units.find((x) => x.code === l.unit);
  return l.qty + ' ' + ((lang === 'kn' && u?.labelKn) || l.unit);
}

/**
 * Items and stock in one list: what each item is, where it is kept, how much each place has,
 * the total, and whether that total is running low. Tapping an item opens its page, with its
 * details and its stock on two tabs.
 */
export function InventoryPage({ readOnly = false }: { readOnly?: boolean }) {
  const { t, lang } = useSession();
  const bi = useBi();
  const nav = useNavigate();
  const base = '/admin/inventory';
  const [params, setParams] = useSearchParams();
  const onlyLow = params.get('low') === '1';
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState('');
  const live = useLive('stock', 'items');
  const { value, error, reload } = useLoad(async () => {
    const [items, stock, locs] = await Promise.all([api.items(true), api.stock(), api.locations()]);
    return { items, stock, locs: locs.filter((l) => l.active) };
  }, [live]);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const { items, stock, locs } = value;
  const qty = new Map(stock.map((s: StockLevel) => [s.itemId + '|' + s.locationId, s.qty]));
  const qtyOf = (i: Item, l: Location) => qty.get(i.id + '|' + l.id) ?? 0;
  const totals = totalsByItem(stock);
  const low = (i: Item) => isLow(i, totals.get(i.id) ?? 0);
  const shop = locs.find((l) => l.kind === 'shop');
  const shown = items.filter((i) => (showAll || i.active) && (!q.trim() || itemMatches(i, q)) && (!onlyLow || (i.active && low(i))));
  const lowCount = items.filter((i) => i.active && low(i)).length;

  const recount = async () => {
    const r = await api.recount();
    setNote(t('stock.recountDone', { n: r.checked, d: r.fixed.length }));
    reload();
  };

  return (
    <>
      <h1 className="title">{bi('Inventory', 'ಸಾಮಾನು ಮತ್ತು ಸ್ಟಾಕ್')}</h1>
      {note && <div className="msg ok">{note}</div>}
      <div className="bar">
        <input className="grow" data-tour="inventory-search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {!readOnly && (
          <Link className="btn primary" to="/admin/inventory/new" data-tour="inventory-new">
            + {t('items.new')}
          </Link>
        )}
        {!readOnly && (
          <button className="btn" onClick={recount} data-tour="inventory-recount">
            {t('stock.recount')}
          </button>
        )}
      </div>
      <div className="bar">
        <label className="check" data-tour="inventory-low">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setParams(e.target.checked ? { low: '1' } : {})} />
          {t('stock.onlyLow')} ({lowCount})
        </label>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t('items.showInactive')}
        </label>
      </div>
      {items.length === 0 && <div className="card" data-tour="inventory-list">{t('items.empty')}</div>}
      {items.length > 0 && shown.length === 0 && (
        <div className="card" data-tour="inventory-list">
          {onlyLow ? bi('Nothing is running low. Good.', 'ಏನೂ ಮುಗಿಯುತ್ತಿಲ್ಲ. ಒಳ್ಳೆಯದು.') : bi('No item matches. Try another name, or add it with “New item”.', 'ಯಾವ ಸಾಮಾನೂ ಹೊಂದುತ್ತಿಲ್ಲ. ಬೇರೆ ಹೆಸರು ನೋಡಿ, ಅಥವಾ “ಹೊಸ ಸಾಮಾನು” ಒತ್ತಿ ಸೇರಿಸಿ.')}
        </div>
      )}
      {shown.length > 0 && (
        <div className="scroll" data-tour="inventory-list">
          <Table className="list">
            <thead>
              <tr>
                <th>{t('stock.item')}</th>
                {locs.map((l) => (
                  <th key={l.id} className="num">
                    {pickName(l.name, l.nameKn, lang)}
                  </th>
                ))}
                <th className="num">{t('stock.total')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const total = totals.get(i.id) ?? 0;
                const isLowNow = i.active && low(i);
                return (
                  <tr key={i.id} className="link" onClick={() => nav(base + '/' + i.id)}>
                    <td>
                      <div className="name">{pickName(i.nameEn, i.nameKn, lang)}</div>
                      <div className="muted">
                        {[lang === 'kn' ? i.nameEn : i.nameKn, i.units.map((u) => u.code).join(' · '), shop && i.racks[shop.id]].filter(Boolean).join(' · ')}
                      </div>
                      {!i.active && <span className="pill">{t('items.inactive')}</span>}
                    </td>
                    {locs.map((l) => {
                      const v = qtyOf(i, l);
                      return (
                        <td key={l.id} className={'num ' + (v < 0 ? 'qty-neg' : '')}>
                          {describeQty(i, v, lang)}
                          {l.kind === 'godown' && i.racks[l.id] && <div className="muted">{i.racks[l.id]}</div>}
                        </td>
                      );
                    })}
                    <td className={'num ' + (total < 0 ? 'qty-neg' : isLowNow ? 'qty-low' : '')}>
                      <b>{describeQty(i, total, lang)}</b>
                      {isLowNow && (
                        <div>
                          <span className="pill warn">
                            {t('stock.low')} · {bi('below', 'ಕಡಿಮೆ:')} {lowWords(i, lang)}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
