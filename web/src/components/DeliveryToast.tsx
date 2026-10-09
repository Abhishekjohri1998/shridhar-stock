import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Delivery } from '@stock/core';
import { http } from '../lib/api';
import { useLiveEvent } from '../lib/live';
import { useBi } from './ui';

type What = 'started' | 'nearby' | 'delivered' | 'failed' | 'located' | 'assigned';
interface Shown {
  what: What;
  name: string;
  worker: string;
  key: number;
}

/** A short two-note blip, made on the spot (no sound file). Quietly nothing where audio is blocked. */
function blip(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + 0.12 + i * 0.12);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    /* no sound */
  }
}

/**
 * Live notes about deliveries, in the same corner style as the running-low note.
 *  - admin: started, nearby, delivered, could not deliver, the customer sent their location;
 *  - worker: a new delivery for them (with a buzz).
 * Tapping opens Deliveries. Only on an open screen: there is no phone notification.
 */
export function DeliveryToast({ role }: { role: 'admin' | 'worker' }) {
  const bi = useBi();
  const [shown, setShown] = useState<Shown | null>(null);
  useLiveEvent('delivery', (id, what) => {
    if (!what) return;
    const w = what as What;
    if (role === 'worker' && w !== 'assigned') return;
    if (role === 'admin' && w === 'assigned') return;
    const load =
      role === 'admin'
        ? http.get<{ deliveries: (Delivery & { personName: string })[] }>('/admin/deliveries').then((r) => r.deliveries.find((d) => d.id === id))
        : http.get<Delivery[]>('/worker/deliveries').then((r) => r.find((d) => d.id === id));
    load
      .then((d) => {
        if (!d) return;
        setShown({ what: w, name: d.name, worker: (d as { personName?: string }).personName ?? '', key: Date.now() });
        blip();
        if (role === 'worker') navigator.vibrate?.([200, 100, 200]);
      })
      .catch(() => undefined);
  });
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 10_000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  const who = shown.worker || bi('The worker', 'ಕೆಲಸಗಾರ');
  const text: Record<What, string> = {
    assigned: bi('New delivery for you: ', 'ನಿಮಗೆ ಹೊಸ ಡೆಲಿವರಿ: ') + shown.name,
    started: who + bi(' is on the way to ', ' ದಾರಿಯಲ್ಲಿದ್ದಾರೆ: ') + shown.name,
    nearby: who + bi(' is near ', ' ಹತ್ತಿರದಲ್ಲಿದ್ದಾರೆ: ') + shown.name,
    delivered: bi('Delivered to ', 'ತಲುಪಿಸಲಾಗಿದೆ: ') + shown.name,
    failed: bi('Could not deliver to ', 'ತಲುಪಿಸಲಾಗಲಿಲ್ಲ: ') + shown.name,
    located: shown.name + bi(' shared their location', ' ತಮ್ಮ ಸ್ಥಳ ಕಳುಹಿಸಿದರು'),
  };
  const icon: Record<What, string> = { assigned: '📦', started: '🏍', nearby: '📍', delivered: '✅', failed: '⚠️', located: '📍' };
  return (
    <Link key={shown.key} className={'toast delivery-toast ' + shown.what} role="status" to={role === 'admin' ? '/admin/deliveries' : '/worker/deliveries'} onClick={() => setShown(null)}>
      <span className="toast-icon" aria-hidden>
        {icon[shown.what]}
      </span>
      <span className="grow">
        <b>{text[shown.what]}</b>
      </span>
    </Link>
  );
}
