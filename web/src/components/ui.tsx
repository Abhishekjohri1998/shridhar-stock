import { useEffect, useState, type ReactNode } from 'react';
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
