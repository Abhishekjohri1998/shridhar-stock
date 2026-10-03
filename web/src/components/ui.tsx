import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { formatRupees, inkBounds, inkPath, type Ink, type Lang } from '@stock/core';
import { useSession } from '../lib/session';
import { http } from '../lib/api';

/** English or Kannada, for the role screens' own words. Both are always written. */
export function useBi() {
  const { lang } = useSession();
  return (en: string, kn: string) => (lang === 'kn' ? kn : en);
}

/**
 * Handwriting, exactly as it was written on the billing tablet (or here), drawn from the strokes.
 * Cropped to the writing so a short word does not sit in a long empty strip.
 */
export function InkView({ ink, height = 40, className }: { ink: Ink; height?: number; className?: string }) {
  const b = inkBounds(ink);
  const pad = 6;
  const w = Math.max(1, b.maxX - b.minX + pad * 2);
  const h = Math.max(1, b.maxY - b.minY + pad * 2);
  return (
    <svg
      className={'ink ' + (className ?? '')}
      viewBox={b.minX - pad + ' ' + (b.minY - pad) + ' ' + w + ' ' + h}
      style={{ height, width: (height * w) / h }}
      role="img"
      aria-label="handwriting"
    >
      <path d={inkPath(ink)} fill="none" stroke="currentColor" strokeWidth={Math.max(2.2, h / 26)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Money as the shop reads it: Indian grouping (₹1,83,106), and whole rupees once it is in the
 * thousands, where paise are noise on a summary. Bills and slips keep their exact amounts.
 */
export function inr(v: number): string {
  const big = Math.abs(v) >= 1000;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: big ? 0 : 2 });
}

export function Money({ v }: { v: number }) {
  return <span className="num">{inr(v)}</span>;
}

export function when(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(lang === 'kn' ? 'kn-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + time;
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'tab on' : 'tab'} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function useTab<K extends string>(first: K) {
  return useState<K>(first);
}

const TONE: Record<string, string> = {
  requested: 'warn',
  sent: 'info',
  received: 'ok',
  cancelled: 'muted',
  ordered: 'warn',
  confirmed: 'info',
  dispatched: 'info',
  pending: 'warn',
  out: 'info',
  delivered: 'ok',
  failed: 'bad',
  new: 'warn',
  done: 'ok',
  declined: 'muted',
  'typed-match': 'ok',
  'read-auto': 'ok',
  'to-confirm': 'warn',
  'not-item': 'muted',
};

export function Status({ s, label }: { s: string; label: string }) {
  return <span className={'pill ' + (TONE[s] ?? '')}>{label}</span>;
}

/**
 * The shop's vehicles as suggestions for a vehicle box: `<input list="vehicles">`. The box still
 * takes anything typed, for a hired auto or a supplier's own lorry.
 */
export function VehicleOptions({ id = 'vehicles' }: { id?: string }) {
  const [list, setList] = useState<{ number: string; type: string; driverName: string }[]>([]);
  useEffect(() => {
    let live = true;
    http
      .get<{ number: string; type: string; driverName: string }[]>('/vehicles')
      .then((v) => live && setList(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <datalist id={id}>
      {list.map((v) => (
        <option key={v.number} value={v.number}>
          {[v.type, v.driverName].filter(Boolean).join(' · ')}
        </option>
      ))}
    </datalist>
  );
}

export function Loading() {
  const { t } = useSession();
  return <p className="muted">{t('common.loading')}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card muted">{children}</div>;
}

/**
 * A `table.list` whose cells carry their column's name in `data-label`, so on a phone the CSS
 * can lay each row out as a card and still say what each number is. The labels are copied from
 * the header after every render, so callers write an ordinary table.
 */
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      let col = 0;
      Array.from(tr.children).forEach((td) => {
        const label = heads[col] ?? '';
        if (label) td.setAttribute('data-label', label);
        else td.removeAttribute('data-label');
        col += (td as HTMLTableCellElement).colSpan || 1;
      });
    });
  });
  return (
    <table ref={ref} className={className}>
      {children}
    </table>
  );
}

/** A number on a card: big serif figure, small label, a small icon. Links when given `to`. */
export function Tile({ n, label, to, tone, icon }: { n: ReactNode; label: ReactNode; to?: string; tone?: string; icon?: IconName }) {
  const cls = 'tile' + (tone ? ' ' + tone : '');
  const body = (
    <>
      {icon && <Icon name={icon} className="tile-icon" />}
      <b>{n}</b>
      <span className="tile-label">{label}</span>
    </>
  );
  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** "Good morning, Shridhar", in the time of day where the shop is. */
export function Greeting({ name }: { name: string }) {
  const bi = useBi();
  const h = new Date().getHours();
  const part = h < 12 ? bi('Good morning', 'ಶುಭೋದಯ') : h < 17 ? bi('Good afternoon', 'ಶುಭ ಮಧ್ಯಾಹ್ನ') : bi('Good evening', 'ಶುಭ ಸಂಜೆ');
  return (
    <h1 className="greeting">
      {part}, {name.split(' ')[0]}
    </h1>
  );
}

const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Sales for each of the last seven days, from the bills the bill list already reads. */
export function useWeekSales(deps: unknown[] = []) {
  const [days, setDays] = useState<{ day: string; total: number; bills: number }[] | null>(null);
  useEffect(() => {
    let live = true;
    http
      .get<{ at: string; total: number; cancelled?: boolean }[]>('/admin/bills?limit=500')
      .then((bills) => {
        const out: { day: string; total: number; bills: number }[] = [];
        for (let i = 6; i >= 0; i--) out.push({ day: istDay(new Date(Date.now() - i * 86_400_000)), total: 0, bills: 0 });
        for (const b of bills) {
          if (b.cancelled) continue;
          const slot = out.find((d) => d.day === istDay(new Date(b.at)));
          if (slot) {
            slot.total += b.total;
            slot.bills += 1;
          }
        }
        if (live) setDays(out);
      })
      .catch(() => live && setDays(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return days;
}

/** Seven bars, today darkest. Drawn as plain SVG; the totals are in the title of each bar. */
export function WeekChart({ days }: { days: { day: string; total: number; bills: number }[] }) {
  const { lang } = useSession();
  const bi = useBi();
  const max = Math.max(1, ...days.map((d) => d.total));
  const W = 320;
  const H = 120;
  const gap = 10;
  const bw = (W - gap * (days.length - 1)) / days.length;
  const week = days.reduce((s, d) => s + d.total, 0);
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <span className="subtitle m-0">{bi('Sales, last 7 days', 'ಕಳೆದ 7 ದಿನಗಳ ಮಾರಾಟ')}</span>
        <b className="chart-total">{inr(week)}</b>
      </div>
      <svg className="chart" viewBox={'0 0 ' + W + ' ' + (H + 22)} role="img" aria-label={bi('Sales, last 7 days', 'ಕಳೆದ 7 ದಿನಗಳ ಮಾರಾಟ')}>
        {days.map((d, i) => {
          const h = d.total ? Math.max(3, (d.total / max) * H) : 2;
          const x = i * (bw + gap);
          const label = new Date(d.day + 'T00:00:00').toLocaleDateString(lang === 'kn' ? 'kn-IN' : 'en-IN', { weekday: 'short' });
          return (
            <g key={d.day}>
              <rect className={i === days.length - 1 ? 'bar-today' : 'bar-day'} x={x} y={H - h} width={bw} height={h} rx={4}>
                <title>
                  {d.day}: {inr(d.total)} · {d.bills} {bi('bills', 'ಬಿಲ್‌ಗಳು')}
                </title>
              </rect>
              <text className="bar-label" x={x + bw / 2} y={H + 16} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
