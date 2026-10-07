import { useState } from 'react';
import { formatRupees, pickName } from '@stock/core';
import { download, http } from '../lib/api';
import { useLive } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { Empty, Loading, Money, Tabs, useBi, when, Table } from '../components/ui';

interface Report {
  period: { from: string; to: string; days: number };
  sales: {
    rows: { itemId: string; name: string; nameKn: string; baseQty: number; amount: number; cost: number; lines: number }[];
    total: number;
    linked: number;
    unlinked: number;
    unlinkedLines: number;
    notStock: number;
    roundTo: number;
    roundOff: number;
  };
  trips: { vehicle: string; type: string; driver: string; transfers: number; deliveries: number }[];
  value: { places: { id: string; name: string; value: number; items: number; negative: number }[]; total: number; noCost: number };
  movers: {
    fast: { itemId: string; name: string; nameKn: string; unit: string; sold: number; perDay: number; have: number; daysLeft: number | null }[];
    slow: { itemId: string; name: string; nameKn: string; unit: string; sold: number; perDay: number; have: number; daysLeft: number | null }[];
  };
  outOfRange: { billNo: number; at: string; line: number; name: string; unit: string; qty: number; rate: number; usual: number; why: 'low' | 'high' | 'far' }[];
}

const day = (offset: number) => new Date(Date.now() + 5.5 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);

/** Reports for the admin. Read only; every table downloads for Excel. */
export function ReportsPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [from, setFrom] = useState(day(29));
  const [to, setTo] = useState(day(0));
  const [tab, setTab] = useState<'sales' | 'value' | 'movers' | 'prices' | 'trips'>('sales');
  const live = useLive('bills', 'stock', 'items');
  const { value: r, error } = useLoad(() => http.get<Report>('/reports?from=' + from + '&to=' + to), [from, to, live]);
  const nm = (x: { name: string; nameKn: string }) => pickName(x.name, x.nameKn, lang);
  const csv = (kind: string) => download('/reports/' + kind + '.csv?from=' + from + '&to=' + to, kind + '-' + from + '-' + to + '.csv');
  const quick = (d: number) => {
    setFrom(day(d));
    setTo(day(0));
  };

  return (
    <>
      <h1 className="title">{bi('Reports', 'ವರದಿಗಳು')}</h1>
      <div className="bar" data-tour="reports-dates">
        <label className="check">
          {bi('From', 'ಇಂದ')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="check">
          {bi('To', 'ವರೆಗೆ')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="chips" data-tour="reports-quick">
          <button className="chip" onClick={() => quick(0)}>{bi('Today', 'ಇಂದು')}</button>
          <button className="chip" onClick={() => quick(6)}>{bi('7 days', '7 ದಿನ')}</button>
          <button className="chip" onClick={() => quick(29)}>{bi('30 days', '30 ದಿನ')}</button>
        </div>
      </div>
      <div data-tour="reports-tabs">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'sales', label: bi('Sales by item', 'ಸಾಮಾನು ಪ್ರಕಾರ ಮಾರಾಟ') },
          { key: 'value', label: bi('Stock value', 'ಸ್ಟಾಕ್ ಮೌಲ್ಯ') },
          { key: 'movers', label: bi('Fast and slow', 'ವೇಗ ಮತ್ತು ನಿಧಾನ') },
          { key: 'prices', label: bi('Prices outside range', 'ಮಿತಿ ಮೀರಿದ ಬೆಲೆ') + (r?.outOfRange.length ? ' (' + r.outOfRange.length + ')' : '') },
          { key: 'trips', label: bi('Trips by vehicle', 'ವಾಹನದ ಪ್ರಕಾರ ಓಡಾಟ') },
        ]}
      />
      </div>
      {error && <div className="msg err">{error}</div>}
      {!r && !error && <Loading />}
      {r && tab === 'sales' && (
        <>
          <div className="tiles" data-tour="reports-sales">
            <div className="tile">
              <b><Money v={r.sales.total} /></b>
              {bi('All takings', 'ಒಟ್ಟು ಮಾರಾಟ')}
            </div>
            <div className="tile">
              <b><Money v={r.sales.linked} /></b>
              {bi('Linked to items', 'ಸಾಮಾನಿಗೆ ಜೋಡಿಸಿದ್ದು')}
            </div>
            <div className={'tile ' + (r.sales.unlinked ? 'warn' : '')}>
              <b><Money v={r.sales.unlinked} /></b>
              {bi('Not linked yet', 'ಇನ್ನೂ ಜೋಡಿಸಿಲ್ಲ')} ({r.sales.unlinkedLines} {bi('lines to digitise', 'ಸಾಲು')})
            </div>
            <div className="tile">
              <b><Money v={r.sales.notStock} /></b>
              {bi('Not stock (charges)', 'ಸ್ಟಾಕ್ ಅಲ್ಲ')}
            </div>
            {r.sales.roundTo > 0 && (
              <div className="tile">
                <b><Money v={r.sales.roundOff} /></b>
                {bi('Round off', 'ರೌಂಡ್ ಆಫ್')} (₹{r.sales.roundTo}) · {bi('collected', 'ಸಂಗ್ರಹ')} {formatRupees(r.sales.total + r.sales.roundOff)}
              </div>
            )}
          </div>
          {r.sales.unlinked > 0 && (
            <p className="muted">
              {bi('The table below counts only linked lines. Digitising handwritten lines makes it complete.', 'ಕೆಳಗಿನ ಪಟ್ಟಿ ಜೋಡಿಸಿದ ಸಾಲುಗಳನ್ನು ಮಾತ್ರ ಎಣಿಸುತ್ತದೆ.')}
            </p>
          )}
          <div className="bar my-10">
            <button className="btn small" data-tour="reports-excel" onClick={() => csv('sales')}>⬇ {bi('Excel', 'ಎಕ್ಸೆಲ್')}</button>
            <button className="btn small" onClick={() => csv('bills')}>⬇ {bi('Every bill line', 'ಎಲ್ಲ ಬಿಲ್ ಸಾಲು')}</button>
          </div>
          {r.sales.rows.length === 0 ? (
            <Empty>{bi('No linked sales in this period.', 'ಈ ಅವಧಿಯಲ್ಲಿ ಮಾರಾಟ ಇಲ್ಲ.')}</Empty>
          ) : (
            <div className="scroll">
              <Table className="list">
                <thead>
                  <tr>
                    <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                    <th className="num">{bi('Sold', 'ಮಾರಿದ್ದು')}</th>
                    <th className="num">{bi('Sales', 'ಮಾರಾಟ')}</th>
                    <th className="num">{bi('Cost', 'ಖರೀದಿ')}</th>
                    <th className="num">{bi('Margin', 'ಲಾಭ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.sales.rows.map((x) => (
                    <tr key={x.itemId}>
                      <td className="name">{nm(x)}</td>
                      <td className="num">{x.baseQty}</td>
                      <td className="num">{formatRupees(x.amount)}</td>
                      <td className="num muted">{x.cost ? formatRupees(x.cost) : '—'}</td>
                      <td className={'num ' + (x.cost && x.amount - x.cost < 0 ? 'qty-neg' : '')}>{x.cost ? formatRupees(x.amount - x.cost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
      {r && tab === 'value' && (
        <>
          <div className="tiles">
            <div className="tile">
              <b><Money v={r.value.total} /></b>
              {bi('Everything, at cost', 'ಎಲ್ಲ, ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ')}
            </div>
            {r.value.places.map((p) => (
              <div className="tile" key={p.id}>
                <b><Money v={p.value} /></b>
                {p.name} · {p.items} {bi('items', 'ಸಾಮಾನು')}
                {p.negative > 0 && <span className="qty-neg"> · {p.negative} {bi('below zero', 'ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ')}</span>}
              </div>
            ))}
          </div>
          {r.value.noCost > 0 && (
            <p className="muted">
              {r.value.noCost} {bi('items have no cost set, so they count as ₹0. Set a cost on the item, or receive a purchase order with “use as cost”.', 'ಸಾಮಾನುಗಳಿಗೆ ಖರೀದಿ ಬೆಲೆ ಇಲ್ಲ, ₹0 ಎಂದು ಎಣಿಸಲಾಗಿದೆ.')}
            </p>
          )}
          <button className="btn small" onClick={() => csv('value')}>⬇ {bi('Excel', 'ಎಕ್ಸೆಲ್')}</button>
        </>
      )}
      {r && tab === 'movers' && (
        <>
          <button className="btn small mb-10" onClick={() => csv('movers')}>⬇ {bi('Excel', 'ಎಕ್ಸೆಲ್')}</button>
          <div className="grid2">
            <div>
              <h2 className="subtitle">⚡ {bi('Selling fastest', 'ಬೇಗ ಮಾರಾಟ')}</h2>
              {r.movers.fast.length === 0 && <Empty>{bi('No sales in this period.', 'ಮಾರಾಟ ಇಲ್ಲ.')}</Empty>}
              {r.movers.fast.map((x) => (
                <div className="card" key={x.itemId}>
                  <div className="name">{nm(x)}</div>
                  <div className="muted">
                    {x.perDay} {x.unit} {bi('a day', 'ದಿನಕ್ಕೆ')} · {bi('in stock', 'ಸ್ಟಾಕ್')} {x.have}
                    {x.daysLeft != null && <span className={x.daysLeft < 7 ? 'qty-neg' : ''}> · {bi('about', 'ಸುಮಾರು')} {x.daysLeft} {bi('days left', 'ದಿನ ಉಳಿದಿದೆ')}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h2 className="subtitle">🐢 {bi('Sitting on the shelf', 'ಮಾರಾಟವಾಗದೆ ಉಳಿದಿದೆ')}</h2>
              {r.movers.slow.map((x) => (
                <div className="card" key={x.itemId}>
                  <div className="name">{nm(x)}</div>
                  <div className="muted">
                    {x.sold ? x.sold + ' ' + x.unit + ' ' + bi('sold', 'ಮಾರಿದ್ದು') : bi('Not sold at all', 'ಮಾರಾಟವೇ ಇಲ್ಲ')} · {bi('in stock', 'ಸ್ಟಾಕ್')} {x.have} {x.unit}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {r && tab === 'trips' && (
        <>
          <p className="muted">
            {bi('Transfers that left a place and deliveries that went out, by the vehicle written on them.', 'ಹೊರಟ ಸಾಗಣೆ ಮತ್ತು ಡೆಲಿವರಿಗಳು, ಅವುಗಳ ಮೇಲೆ ಬರೆದ ವಾಹನದ ಪ್ರಕಾರ.')}
          </p>
          <button className="btn small mb-10" onClick={() => csv('trips')}>⬇ {bi('Excel', 'ಎಕ್ಸೆಲ್')}</button>
          {r.trips.length === 0 ? (
            <Empty>{bi('No trips in this period.', 'ಈ ಅವಧಿಯಲ್ಲಿ ಓಡಾಟ ಇಲ್ಲ.')}</Empty>
          ) : (
            <div className="scroll">
              <Table className="list">
                <thead>
                  <tr>
                    <th>{bi('Vehicle', 'ವಾಹನ')}</th>
                    <th className="num">{bi('Transfers', 'ಸಾಗಣೆ')}</th>
                    <th className="num">{bi('Deliveries', 'ಡೆಲಿವರಿ')}</th>
                    <th className="num">{bi('Trips', 'ಒಟ್ಟು')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.trips.map((x) => (
                    <tr key={x.vehicle}>
                      <td>
                        <div className="name">{x.vehicle}</div>
                        {(x.type || x.driver) && <div className="muted">{[x.type, x.driver].filter(Boolean).join(' · ')}</div>}
                      </td>
                      <td className="num">{x.transfers}</td>
                      <td className="num">{x.deliveries}</td>
                      <td className="num">{x.transfers + x.deliveries}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
      {r && tab === 'prices' && (
        <>
          <p className="muted">
            {bi('Lines billed below the lowest rate, above the highest, or more than 15% away from the item’s price.', 'ಕನಿಷ್ಠಕ್ಕಿಂತ ಕಡಿಮೆ, ಗರಿಷ್ಠಕ್ಕಿಂತ ಹೆಚ್ಚು, ಅಥವಾ ಬೆಲೆಯಿಂದ 15% ದೂರ ಬಿಲ್ ಮಾಡಿದ ಸಾಲುಗಳು.')}
          </p>
          <button className="btn small mb-10" onClick={() => csv('prices')}>⬇ {bi('Excel', 'ಎಕ್ಸೆಲ್')}</button>
          {r.outOfRange.length === 0 ? (
            <Empty>{bi('Every line was billed within range.', 'ಎಲ್ಲ ಸಾಲುಗಳು ಮಿತಿಯೊಳಗಿವೆ.')}</Empty>
          ) : (
            <Table className="list">
              <tbody>
                {r.outOfRange.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <div className="name">{x.name}</div>
                      <div className="muted">
                        {bi('Bill', 'ಬಿಲ್')} #{x.billNo} · {bi('line', 'ಸಾಲು')} {x.line} · {when(x.at, lang)}
                      </div>
                    </td>
                    <td className="num">
                      {x.qty} {x.unit} @ <b className={x.why === 'low' || x.rate < x.usual ? 'qty-neg' : 'qty-low'}>{formatRupees(x.rate)}</b>
                      <div className="muted">
                        {bi('usually', 'ಸಾಮಾನ್ಯ')} {formatRupees(x.usual)}
                      </div>
                    </td>
                    <td>
                      <span className={'pill ' + (x.why === 'low' ? 'bad' : 'warn')}>
                        {x.why === 'low' ? bi('Below lowest', 'ಕನಿಷ್ಠಕ್ಕಿಂತ ಕಡಿಮೆ') : x.why === 'high' ? bi('Above highest', 'ಗರಿಷ್ಠಕ್ಕಿಂತ ಹೆಚ್ಚು') : bi('Far from price', 'ಬೆಲೆಯಿಂದ ದೂರ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </>
  );
}
