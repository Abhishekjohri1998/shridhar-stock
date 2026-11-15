import { useState } from 'react';
import { formatRate, formatRupees, pickName, type StockValueRow } from '@stock/core';
import { Link } from 'react-router-dom';
import { download, http } from '../../lib/api';
import { useLive, useSettled } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Empty, Loading, Money, Select, Table, useBi } from '../../components/ui';

interface StockValueAnswer {
  rows: StockValueRow[];
  total: number;
  noCost: number;
  place: string | null;
  places: { id: string; name: string; nameKn?: string }[];
}

/** Home's "Stock value at cost", item by item: what is held, its cost, and its value, biggest first. */
export function StockValuePage() {
  const bi = useBi();
  const { lang } = useSession();
  const [place, setPlace] = useState('');
  const live = useSettled(useLive('stock', 'items'), 2000);
  const q = place ? '?place=' + encodeURIComponent(place) : '';
  const { value: v, error } = useLoad(() => http.get<StockValueAnswer>('/admin/stock-value' + q), [q, live]);
  return (
    <>
      <h1 className="title">{bi('Stock value at cost', 'ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ ಸ್ಟಾಕ್')}</h1>
      <div className="bar" data-tour="stock-value-bar">
        <Select
          className="w-auto"
          value={place}
          onChange={setPlace}
          aria-label={bi('Place', 'ಜಾಗ')}
          options={[{ value: '', label: bi('All places', 'ಎಲ್ಲಾ ಜಾಗ') }, ...(v?.places ?? []).map((p) => ({ value: p.id, label: pickName(p.name, p.nameKn ?? '', lang) }))]}
        />
        <button type="button" className="btn small" onClick={() => download('/reports/stock-value-items.csv' + q, 'stock-value-items' + (place ? '-' + place : '') + '.csv')}>
          ⬇ {bi('Download (Excel)', 'ಡೌನ್‌ಲೋಡ್ (ಎಕ್ಸೆಲ್)')}
        </button>
        <Link className="btn small ghost" to="/admin">
          {bi('Back to Home', 'ಮುಖಪುಟಕ್ಕೆ ಹಿಂದೆ')}
        </Link>
      </div>
      {error && <div className="msg err">{error}</div>}
      {!v && !error && <Loading />}
      {v && (
        <>
          <div className="tiles">
            <div className="tile">
              <b>
                <Money v={v.total} />
              </b>
              {bi('Total at cost', 'ಒಟ್ಟು ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ')} · {v.rows.length} {bi('items', 'ಸಾಮಾನು')}
            </div>
            {v.noCost > 0 && (
              <div className="tile warn">
                <b>{v.noCost}</b>
                {bi('Items in stock with no cost: counted as ₹0', 'ಖರೀದಿ ಬೆಲೆ ಇಲ್ಲದ ಸಾಮಾನು: ₹0 ಎಂದು ಎಣಿಕೆ')}
              </div>
            )}
          </div>
          {v.rows.length === 0 ? (
            <Empty>{bi('Nothing in stock here.', 'ಇಲ್ಲಿ ಸ್ಟಾಕ್ ಇಲ್ಲ.')}</Empty>
          ) : (
            <div className="scroll mt-10">
              <Table className="list">
                <thead>
                  <tr>
                    <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                    <th className="num">{bi('Held', 'ಇರುವುದು')}</th>
                    <th className="num">{bi('Cost per unit', 'ಘಟಕದ ಖರೀದಿ ಬೆಲೆ')}</th>
                    <th className="num">{bi('Value', 'ಮೌಲ್ಯ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.rows.map((r) => (
                    <tr key={r.itemId}>
                      <td className="name">
                        <Link to={'/admin/inventory/' + r.itemId}>{pickName(r.nameEn, r.nameKn, lang)}</Link>
                        {r.noCost && <span className="pill warn"> {bi('no cost', 'ಖರೀದಿ ಬೆಲೆ ಇಲ್ಲ')}</span>}
                        {!r.active && <span className="pill muted"> {bi('not sold', 'ಮಾರುವುದಿಲ್ಲ')}</span>}
                      </td>
                      <td className="num">
                        {r.qty} {r.unit}
                        {r.unit !== r.baseUnit && (
                          <span className="muted">
                            {' '}
                            ({r.baseQty} {r.baseUnit})
                          </span>
                        )}
                      </td>
                      <td className="num">{r.unitCost == null ? '—' : formatRate(r.unitCost) + ' / ' + r.unit}</td>
                      <td className="num">{formatRupees(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
    </>
  );
}
