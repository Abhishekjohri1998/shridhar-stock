import { pickName } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Link } from 'react-router-dom';
import { Greeting, Loading, Money, Tile, useBi, useWeekSales, WeekChart, when } from '../../components/ui';
import { Icon } from '../../components/Icon';

export interface Summary {
  toConfirm: number;
  low: number;
  /** Items a sale or move took below their level in the last day, still low, newest first. */
  justLow: { itemId: string; at: string; words: string; level: string; nameEn: string; nameKn: string }[];
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

export function AdminHome() {
  const bi = useBi();
  const { lang, me } = useSession();
  const live = useLive('bills', 'stock', 'transfers', 'pos', 'deliveries', 'orders', 'link', 'low');
  const { value: s, error } = useLoad(() => http.get<Summary>('/admin/summary'), [live]);
  const week = useWeekSales([live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!s) return <Loading />;
  const rate = s.handwrittenLines ? Math.round((s.autoRead / s.handwrittenLines) * 100) : 0;
  const needs = [
    { n: s.toConfirm, label: bi('Bill lines to confirm', 'ಖಚಿತಪಡಿಸಬೇಕಾದ ಸಾಲುಗಳು'), to: '/admin/confirm', tone: 'warn', icon: 'checkCircle' as const },
    { n: s.low, label: bi('Running low, all places together', 'ಮುಗಿಯುತ್ತಿದೆ, ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ'), to: '/admin/inventory?low=1', tone: 'warn', icon: 'refill' as const },
    { n: s.negative, label: bi('Below zero: count these', 'ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ: ಎಣಿಸಿ'), to: '/admin/inventory', tone: 'bad', icon: 'alert' as const },
    { n: s.newOrders, label: bi('Customer requests', 'ಗ್ರಾಹಕರ ಬೇಡಿಕೆ'), to: '/admin/requests', tone: 'warn', icon: 'inbox' as const },
  ];
  return (
    <>
      {me && <Greeting name={me.name} />}
      <div className={'banner ' + (s.link?.ok ? 'ok' : 'bad')}>
        {s.link?.ok ? '●' : '○'} {bi('Billing link', 'ಬಿಲ್ಲಿಂಗ್ ಸಂಪರ್ಕ')}:{' '}
        {s.link ? (s.link.ok ? bi('working', 'ಸರಿಯಾಗಿದೆ') + ' · ' + bi('last bill', 'ಕೊನೆಯ ಬಿಲ್') + ' #' + s.link.lastBillNo + (s.link.at ? ' · ' + when(s.link.at, lang) : '') : bi('not reachable', 'ಸಿಗುತ್ತಿಲ್ಲ')) : bi('not set up yet', 'ಇನ್ನೂ ಹೊಂದಿಸಿಲ್ಲ')}
        {s.link?.demo && <span className="muted"> · {bi('demo data', 'ಡೆಮೊ ಮಾಹಿತಿ')}</span>}
      </div>

      <h2 className="subtitle">{bi('Needs you now', 'ಈಗ ನಿಮ್ಮ ಗಮನ ಬೇಕು')}</h2>
      <div className="needs">
        {needs.map((x) => (
          <Link key={x.to + x.icon} className={'need ' + (x.n ? x.tone : 'calm')} to={x.to}>
            <span className="need-icon">
              <Icon name={x.icon} />
            </span>
            <span className="need-text">
              <b>{x.n}</b>
              <span>{x.label}</span>
            </span>
            <Icon name="chevron" className="need-go" />
          </Link>
        ))}
      </div>
      {s.justLow.length > 0 && (
        <div className="card mt-10">
          <div className="subtitle mt-0">{bi('Just went low', 'ಈಗಷ್ಟೇ ಕಡಿಮೆಯಾಗಿದೆ')}</div>
          {s.justLow.map((a) => (
            <Link key={a.itemId} className="move-row low-row" to={'/admin/inventory/' + a.itemId}>
              <b>{pickName(a.nameEn, a.nameKn, lang)}</b>{' '}
              <span className="muted">
                · {a.words} {bi('left in all places, below', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ ಉಳಿದಿದೆ, ಮಿತಿ')} {a.level} · {when(a.at, lang)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {week && <WeekChart days={week} />}

      <h2 className="subtitle">{bi('Moving now', 'ಈಗ ನಡೆಯುತ್ತಿರುವುದು')}</h2>
      <div className="tiles">
        <Tile icon="transfer" n={s.requested} label={bi('Asked from godowns', 'ಗೋದಾಮಿನಿಂದ ಕೇಳಿದ್ದು')} to="/admin/transfers" />
        <Tile icon="truck" n={s.inTransit} label={bi('On the way to the shop', 'ಅಂಗಡಿಗೆ ದಾರಿಯಲ್ಲಿ')} to="/admin/transfers" />
        <Tile icon="cart" n={s.openPos} label={bi('Open purchase orders', 'ತೆರೆದ ಖರೀದಿ ಆರ್ಡರ್')} to="/admin/purchases" />
        <Tile icon="pin" n={s.deliveriesPending} label={bi('Deliveries to do', 'ಬಾಕಿ ಡೆಲಿವರಿ')} to="/admin/deliveries" />
      </div>

      <h2 className="subtitle">{bi('Today', 'ಇಂದು')}</h2>
      <div className="tiles">
        <Tile icon="rupee" n={<Money v={s.salesToday} />} label={<>{bi('Sales from', 'ಮಾರಾಟ,')} {s.billsToday} {bi('bills', 'ಬಿಲ್‌ಗಳು')}</>} />
        <Tile icon="receipt" n={<Money v={s.due} />} label={bi('Money still due', 'ಬರಬೇಕಾದ ಹಣ')} />
        <Tile icon="pen" n={rate + '%'} label={<>{bi('Handwritten lines read by themselves', 'ತಾನಾಗಿ ಓದಿದ ಕೈಬರಹ ಸಾಲುಗಳು')} ({s.autoRead}/{s.handwrittenLines})</>} />
        <Tile icon="box" n={<Money v={s.stockValue} />} label={bi('Stock value at cost', 'ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ ಸ್ಟಾಕ್')} />
      </div>

      {s.reader && (
        <p className="muted mt-14">
          ✎ {bi('Handwriting reader', 'ಕೈಬರಹ ಓದುವಿಕೆ')}: {s.reader.monthLines} {bi('lines this month', 'ಸಾಲು ಈ ತಿಂಗಳು')} · ≈ <Money v={s.reader.monthCostRupees} /> {bi('of', 'ರಲ್ಲಿ')} <Money v={s.reader.capRupees} />
          {s.reader.message && <> · {s.reader.message}</>}
        </p>
      )}
    </>
  );
}
