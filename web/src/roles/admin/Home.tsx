import { pickName } from '@stock/core';
import { http } from '../../lib/api';
import { useLive, useSettled } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Link } from 'react-router-dom';
import { Greeting, Loading, Money, Tile, useBi, WeekChart, when, type WeekDay } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useState } from 'react';
import { ExplainerCard, ExplainerModal } from '../../explainer/entry';

export interface Summary {
  toConfirm: number;
  low: number;
  /** Items a sale or move took below their level in the last day, still low, newest first. */
  justLow: { itemId: string; at: string; words: string; level: string; nameEn: string; nameKn: string }[];
  negative: number;
  inTransit: number;
  requested: number;
  openPos: number;
  salesToday: number;
  billsToday: number;
  due: number;
  stockValue: number;
  handwrittenLines: number;
  link: { ok: boolean; demo?: boolean; lastBillNo?: number; at?: string; message?: string } | null;
}

/** /admin/home: the summary and the week's sales, in one call. */
export interface HomeData extends Summary {
  week: WeekDay[];
}

export function AdminHome() {
  const bi = useBi();
  const { lang, me } = useSession();
  // Re-read on a change, but not more than once every 2 s while the counter is busy.
  const live = useSettled(useLive('bills', 'stock', 'transfers', 'pos', 'link', 'low'), 2000);
  const { value: s, error } = useLoad(() => http.get<HomeData>('/admin/home'), [live]);
  const week = s?.week;
  const [watch, setWatch] = useState(false);
  if (error) return <div className="msg err">{error}</div>;
  if (!s) return <Loading />;
  const needs = [
    { n: s.toConfirm, label: bi('Bill lines to confirm', 'ಖಚಿತಪಡಿಸಬೇಕಾದ ಸಾಲುಗಳು'), to: '/admin/confirm', tone: 'warn', icon: 'checkCircle' as const },
    { n: s.low, label: bi('Running low, all places together', 'ಮುಗಿಯುತ್ತಿದೆ, ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ'), to: '/admin/inventory?low=1', tone: 'warn', icon: 'refill' as const },
    { n: s.negative, label: bi('Below zero: count these', 'ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ: ಎಣಿಸಿ'), to: '/admin/inventory', tone: 'bad', icon: 'alert' as const },
    { n: s.inTransit, label: bi('Transfers on the way', 'ದಾರಿಯಲ್ಲಿರುವ ಸಾಗಣೆ'), to: '/admin/transfers', tone: 'info', icon: 'truck' as const },
  ];
  return (
    <>
      <ExplainerCard onOpen={() => setWatch(true)} />
      {watch && <ExplainerModal onClose={() => setWatch(false)} />}
      {me && <Greeting name={me.name} />}
      <div className={'banner ' + (s.link?.ok ? 'ok' : 'bad')} data-tour="home-link">
        {s.link?.ok ? '●' : '○'} {bi('Billing link', 'ಬಿಲ್ಲಿಂಗ್ ಸಂಪರ್ಕ')}:{' '}
        {s.link ? (s.link.ok ? bi('working', 'ಸರಿಯಾಗಿದೆ') + ' · ' + bi('last bill', 'ಕೊನೆಯ ಬಿಲ್') + ' #' + s.link.lastBillNo + (s.link.at ? ' · ' + when(s.link.at, lang) : '') : bi('not reachable', 'ಸಿಗುತ್ತಿಲ್ಲ')) : bi('not set up yet', 'ಇನ್ನೂ ಹೊಂದಿಸಿಲ್ಲ')}
        {s.link?.demo && <span className="muted"> · {bi('demo data', 'ಡೆಮೊ ಮಾಹಿತಿ')}</span>}
      </div>

      <h2 className="subtitle">{bi('Needs you now', 'ಈಗ ನಿಮ್ಮ ಗಮನ ಬೇಕು')}</h2>
      <div className="needs" data-tour="home-needs">
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
        <div className="card mt-10" data-tour="home-just-low">
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

      {week && (
        <div data-tour="home-week">
          <WeekChart days={week} />
        </div>
      )}

      <h2 className="subtitle">{bi('Moving now', 'ಈಗ ನಡೆಯುತ್ತಿರುವುದು')}</h2>
      <div className="tiles" data-tour="home-moving">
        <Tile icon="transfer" n={s.requested} label={bi('Asked from godowns', 'ಗೋದಾಮಿನಿಂದ ಕೇಳಿದ್ದು')} to="/admin/transfers" />
        <Tile icon="truck" n={s.inTransit} label={bi('On the way to the shop', 'ಅಂಗಡಿಗೆ ದಾರಿಯಲ್ಲಿ')} to="/admin/transfers" />
        <Tile icon="cart" n={s.openPos} label={bi('Open purchase orders', 'ತೆರೆದ ಖರೀದಿ ಆರ್ಡರ್')} to="/admin/purchases" />
      </div>

      <h2 className="subtitle">{bi('Today', 'ಇಂದು')}</h2>
      <div className="tiles" data-tour="home-today">
        <Tile icon="rupee" n={<Money v={s.salesToday} />} label={<>{bi('Sales from', 'ಮಾರಾಟ,')} {s.billsToday} {bi('bills', 'ಬಿಲ್‌ಗಳು')}</>} />
        <Tile icon="receipt" n={<Money v={s.due} />} label={bi('Money still due', 'ಬರಬೇಕಾದ ಹಣ')} />
        <Tile icon="box" n={<Money v={s.stockValue} />} label={bi('Stock value at cost', 'ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ ಸ್ಟಾಕ್')} />
      </div>

    </>
  );
}
