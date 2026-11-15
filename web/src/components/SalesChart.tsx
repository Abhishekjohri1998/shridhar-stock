import { useState } from 'react';
import { defaultUnitOf, formatRupees, round2, type Item, type SeriesBy, type SeriesPoint } from '@stock/core';
import { download, http } from '../lib/api';
import { useLive, useSettled } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { Tabs, useBi } from './ui';

type Metric = 'amount' | 'qty';

/**
 * Sales over time as a plain SVG bar chart: the last 30 shop days or the last 12 months, for one
 * item (amount or quantity) or for the whole shop (amount or bills). Downloads the same numbers.
 */
export function SalesChart({ item, tour }: { item?: Item; tour?: string }) {
  const bi = useBi();
  const { lang } = useSession();
  const [by, setBy] = useState<SeriesBy>('day');
  const [metric, setMetric] = useState<Metric>('amount');
  const live = useSettled(useLive('bills'), 5000);
  const q = '?by=' + by + (item ? '&itemId=' + encodeURIComponent(item.id) : '');
  const { value, error } = useLoad(() => http.get<{ points: SeriesPoint[] }>('/admin/sales-series' + q), [q, live]);
  const unit = item ? defaultUnitOf(item) : null;
  const pts = value?.points ?? [];
  const valueOf = (p: SeriesPoint) => (metric === 'amount' ? p.amount : item && unit ? round2(p.qty / unit.perBase) : p.count);
  const show = (v: number) => (metric === 'amount' ? formatRupees(v) : item && unit ? v + ' ' + unit.code : v + ' ' + bi('bills', 'ಬಿಲ್‌ಗಳು'));
  const total = pts.reduce((s, p) => s + valueOf(p), 0);
  const max = Math.max(1e-9, ...pts.map(valueOf));
  const W = 360;
  const H = 120;
  const gap = by === 'day' ? 2 : 6;
  const bw = pts.length ? (W - gap * (pts.length - 1)) / pts.length : W;
  const loc = lang === 'kn' ? 'kn-IN' : 'en-IN';
  const label = (p: SeriesPoint, i: number) => {
    if (by === 'month') return new Date(p.key + '-01T00:00:00').toLocaleDateString(loc, { month: 'short' });
    // Every fifth day, and the last one, so 30 labels never crowd a phone.
    return (pts.length - 1 - i) % 5 === 0 ? String(Number(p.key.slice(8))) : '';
  };
  const title =
    (item ? bi('Sales of this item', 'ಈ ಸಾಮಾನಿನ ಮಾರಾಟ') : bi('Sales over time', 'ಮಾರಾಟದ ಏರಿಳಿತ')) +
    ', ' +
    (by === 'day' ? bi('last 30 days', 'ಕಳೆದ 30 ದಿನ') : bi('last 12 months', 'ಕಳೆದ 12 ತಿಂಗಳು'));
  const csv = () => download('/reports/sales-series.csv' + q, 'sales-by-' + by + (item ? '-' + item.id : '-all') + '.csv');
  return (
    <div className="card chart-card" data-tour={tour}>
      <div className="chart-head">
        <span className="subtitle m-0">{title}</span>
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
          ]}
        />
        <button type="button" className="btn small" onClick={() => csv()}>
          ⬇ {bi('Download (Excel)', 'ಡೌನ್‌ಲೋಡ್ (ಎಕ್ಸೆಲ್)')}
        </button>
      </div>
      {error && <div className="msg err">{error}</div>}
      <svg className="chart" viewBox={'0 0 ' + W + ' ' + (H + 22)} role="img" aria-label={title + ': ' + show(round2(total))}>
        {pts.map((p, i) => {
          const v = valueOf(p);
          const h = v ? Math.max(3, (v / max) * H) : 2;
          const x = i * (bw + gap);
          const l = label(p, i);
          return (
            <g key={p.key}>
              <rect className={i === pts.length - 1 ? 'bar-today' : 'bar-day'} x={x} y={H - h} width={bw} height={h} rx={by === 'day' ? 2 : 4}>
                <title>
                  {p.key}: {formatRupees(p.amount)}
                  {item && unit ? ' · ' + round2(p.qty / unit.perBase) + ' ' + unit.code : ' · ' + p.count + ' ' + bi('bills', 'ಬಿಲ್‌ಗಳು')}
                </title>
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
    </div>
  );
}
