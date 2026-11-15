import { useState } from 'react';
import { defaultUnitOf, formatRate, formatRupees, pickName, round2, seriesKeys, stepWindow, type Item, type SeriesBy, type SeriesPoint } from '@stock/core';
import { Link } from 'react-router-dom';
import { download, http } from '../lib/api';
import { useLive, useSettled } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { Table, Tabs, useBi } from './ui';

type Metric = 'amount' | 'qty' | 'profit';

interface Details {
  keys: string[];
  amount: number;
  bills: number;
  qty: number;
  linkedSales: number;
  costedSales: number;
  cost: number;
  profit: number;
  margin: number | null;
  noCostItems: number;
  itemId: string | null;
  items: { itemId: string; nameEn: string; nameKn: string; unit: string; unitQty: number; qty: number; baseUnit: string; amount: number; lines: number; cost: number | null; profit: number | null }[];
  rows: { billNo: number; at: string; total: number; qty: number; unit: string; rate: number; amount: number; cost: number | null; profit: number | null }[];
}

/**
 * Sales over time as a plain SVG bar chart, for one item or the whole shop. Like a bank statement:
 * a window of 30 days or 12 months, stepped back and forward, never past today. Tap bars to pick
 * them (tap again to drop one); the panel under the chart adds up everything picked.
 */
export function SalesChart({ item, tour }: { item?: Item; tour?: string }) {
  const bi = useBi();
  const { lang } = useSession();
  const [by, setByRaw] = useState<SeriesBy>('day');
  const [start, setStart] = useState('');
  const [metric, setMetric] = useState<Metric>('amount');
  const [picked, setPicked] = useState<string[]>([]);
  const live = useSettled(useLive('bills'), 5000);
  const setBy = (b: SeriesBy) => {
    setByRaw(b);
    setStart('');
    setPicked([]);
  };
  const itemQ = item ? '&itemId=' + encodeURIComponent(item.id) : '';
  const q = '?by=' + by + (start ? '&start=' + start : '') + itemQ;
  const { value, error } = useLoad(() => http.get<{ points: SeriesPoint[]; start: string; latest: string }>('/admin/sales-series' + q), [q, live]);
  const dq = picked.length ? '?by=' + by + '&keys=' + [...picked].sort().join(',') + itemQ : '';
  const details = useLoad(() => (dq ? http.get<Details>('/admin/sales-details' + dq) : Promise.resolve(null)), [dq, live]);
  const unit = item ? defaultUnitOf(item) : null;
  const pts = value?.points ?? [];
  const winStart = value?.start ?? seriesKeys(by)[0]!;
  const isLatest = !value || value.start === value.latest;
  const valueOf = (p: SeriesPoint) => (metric === 'amount' ? p.amount : metric === 'profit' ? p.profit : item && unit ? round2(p.qty / unit.perBase) : p.count);
  const show = (v: number) => (metric === 'amount' ? formatRupees(v) : metric === 'profit' ? (v < 0 ? bi('Loss', 'ನಷ್ಟ') + ' ' + formatRupees(-v) : formatRupees(v)) : item && unit ? v + ' ' + unit.code : v + ' ' + bi('bills', 'ಬಿಲ್‌ಗಳು'));
  const total = pts.reduce((s, p) => s + valueOf(p), 0);
  // A loss is drawn as a bar of its size in the loss colour; the scale is the biggest size either way.
  const max = Math.max(1e-9, ...pts.map((p) => Math.abs(valueOf(p))));
  const W = 360;
  const H = 120;
  const gap = by === 'day' ? 2 : 6;
  const bw = pts.length ? (W - gap * (pts.length - 1)) / pts.length : W;
  const loc = lang === 'kn' ? 'kn-IN' : 'en-IN';
  const dateOf = (k: string) => new Date((k.length === 7 ? k + '-01' : k) + 'T00:00:00');
  const dayName = (k: string, year: boolean) => dateOf(k).toLocaleDateString(loc, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
  const monthName = (k: string, year: boolean) => dateOf(k).toLocaleDateString(loc, { month: 'short', ...(year ? { year: 'numeric' } : {}) });
  const name = (k: string) => (by === 'day' ? dayName(k, true) : monthName(k, true));
  const range = pts.length ? (by === 'day' ? dayName(pts[0]!.key, false) : monthName(pts[0]!.key, true)) + ' – ' + name(pts[pts.length - 1]!.key) : '';
  const label = (p: SeriesPoint, i: number) => {
    if (by === 'month') return monthName(p.key, false);
    // Every fifth day, and the last one, so 30 labels never crowd a phone.
    return (pts.length - 1 - i) % 5 === 0 ? String(Number(p.key.slice(8))) : '';
  };
  const title = item ? bi('Sales of this item', 'ಈ ಸಾಮಾನಿನ ಮಾರಾಟ') : bi('Sales over time', 'ಮಾರಾಟದ ಏರಿಳಿತ');
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const step = (dir: -1 | 1) => {
    const next = stepWindow(by, winStart, dir);
    if (next) setStart(next);
  };
  const today = seriesKeys('day')[29]!;
  const csv = () => download('/reports/sales-series.csv' + q, 'sales-by-' + by + '-from-' + winStart + (item ? '-' + item.id : '-all') + '.csv');
  const d = details.value;
  return (
    <div className="card chart-card" data-tour={tour}>
      <div className="chart-head">
        <span className="subtitle m-0">
          {title} · {range}
        </span>
        <b className="chart-total">{show(round2(total))}</b>
      </div>
      <div className="bar mb-0">
        <Tabs<SeriesBy>
          value={by}
          onChange={setBy}
          tabs={[
            { key: 'day', label: bi('Day', 'ದಿನ') },
            { key: 'month', label: bi('Month', 'ತಿಂಗಳು') },
          ]}
        />
        <Tabs<Metric>
          value={metric}
          onChange={setMetric}
          tabs={[
            { key: 'amount', label: bi('₹ Amount', '₹ ಮೊತ್ತ') },
            { key: 'qty', label: item ? bi('Quantity', 'ಪ್ರಮಾಣ') : bi('Bills', 'ಬಿಲ್‌ಗಳು') },
            { key: 'profit', label: bi('Profit', 'ಲಾಭ') },
          ]}
        />
      </div>
      <div className="bar mb-0">
        <button type="button" className="btn small" onClick={() => step(-1)}>
          ‹ {bi('Earlier', 'ಹಿಂದೆ')}
        </button>
        <label className="check">
          {bi('From', 'ಇಂದ')}{' '}
          {by === 'day' ? (
            <input type="date" value={winStart} max={today} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label={bi('Start date', 'ಆರಂಭದ ದಿನಾಂಕ')} />
          ) : (
            <input type="month" value={winStart} max={today.slice(0, 7)} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label={bi('Start month', 'ಆರಂಭದ ತಿಂಗಳು')} />
          )}
        </label>
        <button type="button" className="btn small" disabled={isLatest} onClick={() => step(1)}>
          {bi('Later', 'ಮುಂದೆ')} ›
        </button>
        <button type="button" className="btn small ghost" disabled={isLatest} onClick={() => setStart('')}>
          {bi('Latest', 'ಇತ್ತೀಚಿನದು')}
        </button>
        <button type="button" className="btn small" onClick={() => csv()}>
          ⬇ {bi('Download (Excel)', 'ಡೌನ್‌ಲೋಡ್ (ಎಕ್ಸೆಲ್)')}
        </button>
      </div>
      {error && <div className="msg err">{error}</div>}
      <svg className="chart" viewBox={'0 0 ' + W + ' ' + (H + 22)} role="group" aria-label={title + ', ' + range + ': ' + show(round2(total))}>
        {pts.map((p, i) => {
          const v = valueOf(p);
          const h = v ? Math.max(3, (Math.abs(v) / max) * H) : 2;
          const x = i * (bw + gap);
          const l = label(p, i);
          const on = picked.includes(p.key);
          const tip =
            name(p.key) +
            ': ' +
            formatRupees(p.amount) +
            (item && unit ? ' · ' + round2(p.qty / unit.perBase) + ' ' + unit.code : ' · ' + p.count + ' ' + bi('bills', 'ಬಿಲ್‌ಗಳು')) +
            ' · ' +
            (p.profit < 0 ? bi('loss', 'ನಷ್ಟ') + ' ' + formatRupees(-p.profit) : bi('profit', 'ಲಾಭ') + ' ' + formatRupees(p.profit));
          return (
            <g
              key={p.key}
              className="bar-hit"
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={tip}
              onClick={() => toggle(p.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(p.key);
                }
              }}
            >
              {/* The whole column is the tap target, not just the bar, so a short bar is easy to hit. */}
              <rect className="bar-pad" x={x - gap / 2} y={0} width={bw + gap} height={H + 22} />
              <rect className={on ? 'bar-picked' : v < 0 ? 'bar-loss' : i === pts.length - 1 && isLatest ? 'bar-today' : 'bar-day'} x={x} y={H - h} width={bw} height={h} rx={by === 'day' ? 2 : 4}>
                <title>{tip}</title>
              </rect>
              {l && (
                <text className="bar-label" x={x + bw / 2} y={H + 16} textAnchor="middle">
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {picked.length === 0 && <p className="muted mb-0">{bi('Tap a bar to see what sold then; tap more bars to add them up.', 'ಆ ಸಮಯದಲ್ಲಿ ಏನು ಮಾರಿದೆ ಎಂದು ನೋಡಲು ಕಂಬವನ್ನು ಒತ್ತಿ; ಸೇರಿಸಿ ನೋಡಲು ಇನ್ನಷ್ಟು ಒತ್ತಿ.')}</p>}
      {picked.length > 0 && (
        <div className="sel-panel">
          <div className="bar mb-0">
            <b className="grow">
              {picked.length === 1 ? name(picked[0]!) : picked.length + ' ' + (by === 'day' ? bi('days picked', 'ದಿನಗಳು ಆರಿಸಲಾಗಿದೆ') : bi('months picked', 'ತಿಂಗಳು ಆರಿಸಲಾಗಿದೆ'))}
            </b>
            <button type="button" className="btn small" onClick={() => download('/reports/sales-details.csv' + dq, 'sales-details-' + by + '.csv')}>
              ⬇ {bi('Download (Excel)', 'ಡೌನ್‌ಲೋಡ್ (ಎಕ್ಸೆಲ್)')}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setPicked([])}>
              {bi('Clear', 'ತೆರವುಗೊಳಿಸಿ')}
            </button>
          </div>
          {picked.length > 1 && <p className="muted">{[...picked].sort().map((k) => (by === 'day' ? dayName(k, false) : monthName(k, true))).join(', ')}</p>}
          {details.error && <div className="msg err">{details.error}</div>}
          {d && (
            <>
              <div className="tiles mt-10">
                <div className="tile">
                  <b>{formatRupees(d.amount)}</b>
                  {bi('Sales', 'ಮಾರಾಟ')}
                </div>
                <div className="tile">
                  <b>{d.bills}</b>
                  {bi('Bills', 'ಬಿಲ್‌ಗಳು')}
                </div>
                {item && unit && (
                  <div className="tile">
                    <b>
                      {round2(d.qty / unit.perBase)} {unit.code}
                    </b>
                    {bi('Quantity', 'ಪ್ರಮಾಣ')}
                  </div>
                )}
                <div className="tile">
                  <b>{formatRupees(d.cost)}</b>
                  {bi('Cost', 'ಖರೀದಿ ಬೆಲೆ')}
                </div>
                <div className={'tile ' + (d.profit < 0 ? 'bad' : 'ok')}>
                  <b className={d.profit < 0 ? 'loss' : 'gain'}>{formatRupees(Math.abs(d.profit))}</b>
                  {d.profit < 0 ? bi('Loss', 'ನಷ್ಟ') : bi('Profit', 'ಲಾಭ')}
                  {d.margin != null && ' · ' + d.margin + '% ' + bi('margin', 'ಲಾಭಾಂಶ')}
                </div>
              </div>
              {!item && d.costedSales > 0 && (
                <p className="muted mb-0">
                  {bi('Profit is of ' + formatRupees(d.costedSales) + ' sales linked to items with a cost (of ' + formatRupees(d.amount) + ' in all).', 'ಲಾಭ ಖರೀದಿ ಬೆಲೆ ಇರುವ ಸಾಮಾನಿನ ' + formatRupees(d.costedSales) + ' ಮಾರಾಟದ ಮೇಲೆ (ಒಟ್ಟು ' + formatRupees(d.amount) + ').')}
                </p>
              )}
              {d.noCostItems > 0 && (
                <div className="msg warn mt-10">
                  {bi('Cost not set for ' + d.noCostItems + (d.noCostItems === 1 ? ' item' : ' items') + '; profit leaves them out.', d.noCostItems + ' ಸಾಮಾನಿಗೆ ಖರೀದಿ ಬೆಲೆ ಇಲ್ಲ; ಲಾಭದಲ್ಲಿ ಅವನ್ನು ಸೇರಿಸಿಲ್ಲ.')}
                </div>
              )}
              {!item && d.items.length > 0 && (
                <div className="scroll mt-10">
                  <Table className="list">
                    <thead>
                      <tr>
                        <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                        <th className="num">{bi('Sold', 'ಮಾರಿದ್ದು')}</th>
                        <th className="num">{bi('Amount', 'ಮೊತ್ತ')}</th>
                        <th className="num">{bi('Cost', 'ಖರೀದಿ ಬೆಲೆ')}</th>
                        <th className="num">{bi('Profit', 'ಲಾಭ')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.slice(0, 50).map((r) => (
                        <tr key={r.itemId}>
                          <td className="name">
                            <Link to={'/admin/inventory/' + r.itemId}>{pickName(r.nameEn, r.nameKn, lang)}</Link>
                          </td>
                          <td className="num">
                            {r.unitQty} {r.unit}
                          </td>
                          <td className="num">{formatRupees(r.amount)}</td>
                          <CostCells cost={r.cost} profit={r.profit} />
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {d.items.length > 50 && <p className="muted">{bi('Top 50 shown; the download has every item.', 'ಮೊದಲ 50 ಮಾತ್ರ; ಡೌನ್‌ಲೋಡ್‌ನಲ್ಲಿ ಎಲ್ಲವೂ ಇದೆ.')}</p>}
                </div>
              )}
              {d.rows.length > 0 && (
                <div className="scroll mt-10">
                  <Table className="list">
                    <thead>
                      <tr>
                        <th>{bi('Bill', 'ಬಿಲ್')}</th>
                        <th>{bi('Time', 'ಸಮಯ')}</th>
                        {item && <th className="num">{bi('Qty', 'ಪ್ರಮಾಣ')}</th>}
                        {item && <th className="num">{bi('Rate', 'ದರ')}</th>}
                        <th className="num">{bi('Amount', 'ಮೊತ್ತ')}</th>
                        {item && <th className="num">{bi('Cost', 'ಖರೀದಿ ಬೆಲೆ')}</th>}
                        {item && <th className="num">{bi('Profit', 'ಲಾಭ')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.slice(0, 100).map((r, k) => (
                        <tr key={r.billNo + '-' + k}>
                          <td>#{r.billNo}</td>
                          <td>{new Date(r.at).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                          {item && (
                            <td className="num">
                              {r.qty} {r.unit}
                            </td>
                          )}
                          {item && <td className="num">{formatRate(r.rate)}</td>}
                          <td className="num">{formatRupees(r.amount)}</td>
                          {item && <CostCells cost={r.cost} profit={r.profit} />}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {d.rows.length > 100 && <p className="muted">{bi('Latest 100 shown; the download has all.', 'ಇತ್ತೀಚಿನ 100 ಮಾತ್ರ; ಡೌನ್‌ಲೋಡ್‌ನಲ್ಲಿ ಎಲ್ಲವೂ ಇದೆ.')}</p>}
                </div>
              )}
              {d.rows.length === 0 && <p className="muted">{bi('No sales then.', 'ಆಗ ಮಾರಾಟ ಇಲ್ಲ.')}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Cost and profit cells: "no cost" when the item has none; a loss in the loss colour, marked as one. */
function CostCells({ cost, profit }: { cost: number | null; profit: number | null }) {
  const bi = useBi();
  if (cost == null || profit == null)
    return (
      <>
        <td className="num muted">{bi('no cost', 'ಖರೀದಿ ಬೆಲೆ ಇಲ್ಲ')}</td>
        <td className="num muted">—</td>
      </>
    );
  return (
    <>
      <td className="num">{formatRupees(cost)}</td>
      <td className={'num ' + (profit < 0 ? 'loss' : 'gain')}>{profit < 0 ? bi('Loss', 'ನಷ್ಟ') + ' ' + formatRupees(-profit) : formatRupees(profit)}</td>
    </>
  );
}
