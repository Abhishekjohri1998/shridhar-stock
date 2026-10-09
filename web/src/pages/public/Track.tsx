import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { DeliveryStatus, DeliveryStep, VehicleKind } from '@stock/core';
import { LiveMap, type LatLng, type MapMarker } from '../../components/LiveMap';
import { Timeline } from '../../components/Timeline';
import { useBi } from '../../components/ui';
import { useSession } from '../../lib/session';
import { clockText } from '../../lib/share';

/** What the server shows a customer of their delivery (see server/src/routes/public.ts). */
interface TrackView {
  id: string;
  shopName: string;
  shopPhone: string;
  shop: LatLng | null;
  status: DeliveryStatus;
  steps: DeliveryStep[];
  worker: string;
  vehicleKind: VehicleKind;
  home: LatLng | null;
  pos?: LatLng & { at: string };
  route?: LatLng[];
  eta?: { minutes: number; at: string };
  otp?: string;
  toPay?: number;
  deliveredAt?: string;
}

/** Fetches a public page's data with no sign-in. 404 means the link has ended. */
export async function publicGet<T>(path: string): Promise<T | 'gone'> {
  const r = await fetch('/api' + path, { cache: 'no-store' });
  if (r.status === 404) return 'gone';
  if (!r.ok) throw new Error('Could not load. Check the internet and try again.');
  return (await r.json()) as T;
}

/** A number that counts smoothly to its new value instead of jumping. */
export function CountTo({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 600);
      const v = Math.round(a + (value - a) * (1 - (1 - k) ** 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

/** EN / ಕನ್ನಡ, for a customer who is not signed in. */
export function LangSwitch() {
  const { lang, setLang } = useSession();
  return (
    <button type="button" className="chip" onClick={() => setLang(lang === 'kn' ? 'en' : 'kn')}>
      {lang === 'kn' ? 'English' : 'ಕನ್ನಡ'}
    </button>
  );
}

/** /t/:id/:tok — the customer's live tracking page. */
export function TrackPage() {
  const bi = useBi();
  const { id = '', tok = '' } = useParams();
  const [v, setV] = useState<TrackView | 'gone' | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const dragY = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    publicGet<TrackView>('/t/' + id + '/' + tok)
      .then((x) => {
        if (!live) return;
        setV(x);
        setErr('');
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [id, tok, n]);

  // Live: the server says "changed" for this one delivery; a slow poll is the safety net.
  const over = v === 'gone' || (v && v.status !== 'pending' && v.status !== 'out');
  useEffect(() => {
    if (over) return;
    const es = new EventSource('/api/t/' + id + '/' + tok + '/events');
    es.addEventListener('change', () => setN((x) => x + 1));
    es.addEventListener('hello', () => setN((x) => x + 1));
    const t = setInterval(() => setN((x) => x + 1), 30_000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [id, tok, over]);

  if (v === 'gone')
    return (
      <div className="public-page">
        <div className="card public-card">
          <h1 className="title">{bi('This link has ended', 'ಈ ಲಿಂಕ್ ಮುಗಿದಿದೆ')}</h1>
          <p className="muted">{bi('The delivery is over. Ask the shop if anything is wrong.', 'ಡೆಲಿವರಿ ಮುಗಿದಿದೆ. ಏನಾದರೂ ತಪ್ಪಿದ್ದರೆ ಅಂಗಡಿಯನ್ನು ಕೇಳಿ.')}</p>
        </div>
      </div>
    );
  if (!v) return <div className="public-page muted">{err || bi('Loading…', 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…')}</div>;

  const markers: MapMarker[] = [];
  if (v.shop) markers.push({ id: 'shop', ...v.shop, icon: '🏪', label: v.shopName, faded: v.status === 'out' });
  if (v.home) markers.push({ id: 'home', ...v.home, icon: v.status === 'delivered' ? '✅' : '🏠', label: bi('You', 'ನೀವು') });
  if (v.pos) markers.push({ id: 'go', lat: v.pos.lat, lng: v.pos.lng, icon: v.vehicleKind === 'car' ? '🚚' : '🏍', label: v.worker, moving: true, route: v.route });
  const fit = markers.filter((m) => m.id !== 'shop' || !v.pos);
  const delivered = v.status === 'delivered';

  return (
    <div className="track-page">
      <LiveMap className="track-map" markers={markers} fit={fit} locate locateLabel={bi('Show where I am', 'ನಾನು ಎಲ್ಲಿದ್ದೇನೆ')} />
      <section
        className={'track-sheet' + (collapsed ? ' collapsed' : '')}
        aria-live="polite"
        onPointerDown={(e) => (dragY.current = e.clientY)}
        onPointerUp={(e) => {
          // A swipe down folds the sheet to show more map; a swipe up opens it again.
          if (dragY.current == null) return;
          const dy = e.clientY - dragY.current;
          dragY.current = null;
          if (dy > 40) setCollapsed(true);
          else if (dy < -40) setCollapsed(false);
        }}
      >
        <button type="button" className="sheet-handle" aria-label={collapsed ? bi('Show details', 'ವಿವರ ತೋರಿಸಿ') : bi('Show more map', 'ಹೆಚ್ಚು ನಕ್ಷೆ ತೋರಿಸಿ')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} />
        <div className="bar between m-0">
          <b className="track-shop">{v.shopName}</b>
          <LangSwitch />
        </div>
        {delivered ? (
          <div className="track-done">
            <svg className="check-draw" viewBox="0 0 52 52" aria-hidden>
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27 l7 7 l15 -16" />
            </svg>
            <div>
              <div className="track-eta">{bi('Delivered', 'ತಲುಪಿತು')}</div>
              {v.deliveredAt && <div className="muted">{bi('at ', '') + clockText(v.deliveredAt) + bi('', 'ಕ್ಕೆ')}</div>}
            </div>
          </div>
        ) : v.status === 'out' ? (
          <div className="track-eta">
            {v.eta ? (
              <>
                {bi('Arriving in ', 'ಬರಲು ')}
                <span className="track-min">
                  <CountTo value={v.eta.minutes} />
                </span>
                {bi(' min', ' ನಿಮಿಷ')}
              </>
            ) : (
              bi('On the way', 'ದಾರಿಯಲ್ಲಿದೆ')
            )}
          </div>
        ) : (
          <div className="track-eta">{bi('Your order is being packed', 'ನಿಮ್ಮ ಆರ್ಡರ್ ಪ್ಯಾಕ್ ಆಗುತ್ತಿದೆ')}</div>
        )}
        <div className="sheet-more">
        <Timeline steps={v.steps} bi={bi} />
        {v.otp && (
          <div className="otp-card" data-tour="track-otp">
            <span>{bi('Tell this code to the delivery person', 'ಡೆಲಿವರಿಯವರಿಗೆ ಈ ಕೋಡ್ ಹೇಳಿ')}</span>
            <span className="otp-digits">
              {v.otp.split('').map((c, i) => (
                <b key={i}>{c}</b>
              ))}
            </span>
          </div>
        )}
        <div className="bar between m-0">
          <span className="muted">
            {v.worker && (v.vehicleKind === 'car' ? '🚚 ' : '🏍 ') + v.worker}
            {v.toPay ? ' · ' + bi('To pay ₹', 'ಪಾವತಿಸಬೇಕು ₹') + v.toPay : ''}
          </span>
          {v.shopPhone && (
            <a className="btn" href={'tel:' + v.shopPhone}>
              📞 {bi('Call shop', 'ಅಂಗಡಿಗೆ ಕರೆ')}
            </a>
          )}
        </div>
        </div>
      </section>
    </div>
  );
}
