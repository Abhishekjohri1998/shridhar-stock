import { Link } from 'react-router-dom';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Loading, Money, useBi, when } from '../../components/ui';

export interface Summary {
  toConfirm: number;
  low: number;
  negative: number;
  inTransit: number;
  requested: number;
  openPos: number;
  deliveriesToday: number;
  deliveriesPending: number;
  newOrders: number;
  salesToday: number;
  billsToday: number;
  due: number;
  stockValue: number;
  handwrittenLines: number;
  autoRead: number;
  link: { ok: boolean; demo?: boolean; lastBillNo?: number; at?: string; message?: string } | null;
  reader: { enabled: boolean; demo?: boolean; monthLines: number; monthCostRupees: number; capRupees: number; message?: string } | null;
}

function Tile({ n, label, to, tone }: { n: number | string; label: string; to: string; tone?: 'warn' | 'bad' | '' }) {
  return (
    <Link className={'tile ' + (tone && n ? tone : '')} to={to}>
      <b>{n}</b>
      {label}
    </Link>
  );
}

export function AdminHome() {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('bills', 'stock', 'transfers', 'pos', 'deliveries', 'orders', 'link');
  const { value: s, error } = useLoad(() => http.get<Summary>('/admin/summary'), [live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!s) return <Loading />;
  const rate = s.handwrittenLines ? Math.round((s.autoRead / s.handwrittenLines) * 100) : 0;
  return (
    <>
      <div className={'banner ' + (s.link?.ok ? 'ok' : 'bad')}>
        {s.link?.ok ? '●' : '○'} {bi('Billing link', 'ಬಿಲ್ಲಿಂಗ್ ಸಂಪರ್ಕ')}:{' '}
        {s.link ? (s.link.ok ? bi('working', 'ಸರಿಯಾಗಿದೆ') + ' · ' + bi('last bill', 'ಕೊನೆಯ ಬಿಲ್') + ' #' + s.link.lastBillNo + (s.link.at ? ' · ' + when(s.link.at, lang) : '') : bi('not reachable', 'ಸಿಗುತ್ತಿಲ್ಲ')) : bi('not set up yet', 'ಇನ್ನೂ ಹೊಂದಿಸಿಲ್ಲ')}
        {s.link?.demo && <span className="muted"> · {bi('demo data', 'ಡೆಮೊ ಮಾಹಿತಿ')}</span>}
      </div>

      <h2 className="subtitle">{bi('Needs you', 'ನಿಮ್ಮ ಗಮನ ಬೇಕು')}</h2>
      <div className="tiles">
        <Tile n={s.toConfirm} label={bi('Bill lines to confirm', 'ಖಚಿತಪಡಿಸಬೇಕಾದ ಸಾಲುಗಳು')} to="/admin/confirm" tone="warn" />
        <Tile n={s.low} label={bi('Running low in the shop', 'ಅಂಗಡಿಯಲ್ಲಿ ಮುಗಿಯುತ್ತಿದೆ')} to="/admin/refill" tone="warn" />
        <Tile n={s.negative} label={bi('Below zero: count these', 'ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ: ಎಣಿಸಿ')} to="/admin/stock" tone="bad" />
        <Tile n={s.newOrders} label={bi('Customer requests', 'ಗ್ರಾಹಕರ ಬೇಡಿಕೆ')} to="/admin/requests" tone="warn" />
      </div>

      <h2 className="subtitle">{bi('Moving now', 'ಈಗ ನಡೆಯುತ್ತಿರುವುದು')}</h2>
      <div className="tiles">
        <Tile n={s.requested} label={bi('Asked from godowns', 'ಗೋದಾಮಿನಿಂದ ಕೇಳಿದ್ದು')} to="/admin/transfers" />
        <Tile n={s.inTransit} label={bi('On the way to the shop', 'ಅಂಗಡಿಗೆ ದಾರಿಯಲ್ಲಿ')} to="/admin/transfers" />
        <Tile n={s.openPos} label={bi('Open purchase orders', 'ತೆರೆದ ಖರೀದಿ ಆರ್ಡರ್')} to="/admin/purchases" />
        <Tile n={s.deliveriesPending} label={bi('Deliveries to do', 'ಬಾಕಿ ಡೆಲಿವರಿ')} to="/admin/deliveries" />
      </div>

      <h2 className="subtitle">{bi('Today', 'ಇಂದು')}</h2>
      <div className="tiles">
        <div className="tile">
          <b>
            <Money v={s.salesToday} />
          </b>
          {bi('Sales from', 'ಮಾರಾಟ,')} {s.billsToday} {bi('bills', 'ಬಿಲ್‌ಗಳು')}
        </div>
        <div className="tile">
          <b>
            <Money v={s.due} />
          </b>
          {bi('Money still due', 'ಬರಬೇಕಾದ ಹಣ')}
        </div>
        <div className="tile">
          <b>{rate}%</b>
          {bi('Handwritten lines read by themselves', 'ತಾನಾಗಿ ಓದಿದ ಕೈಬರಹ ಸಾಲುಗಳು')} ({s.autoRead}/{s.handwrittenLines})
        </div>
        <div className="tile">
          <b>
            <Money v={s.stockValue} />
          </b>
          {bi('Stock value at cost', 'ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ ಸ್ಟಾಕ್')}
        </div>
      </div>

      {s.reader && (
        <p className="muted" style={{ marginTop: 14 }}>
          ✎ {bi('Handwriting reader', 'ಕೈಬರಹ ಓದುವಿಕೆ')}: {s.reader.monthLines} {bi('lines this month', 'ಸಾಲು ಈ ತಿಂಗಳು')} · ≈ <Money v={s.reader.monthCostRupees} /> {bi('of', 'ರಲ್ಲಿ')} <Money v={s.reader.capRupees} />
          {s.reader.message && <> · {s.reader.message}</>}
        </p>
      )}
    </>
  );
}
