import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBi } from '../../components/ui';
import { LangSwitch, publicGet } from './Track';

/** A fix this sure (metres) is sent at once; otherwise the best one after 15 s. */
const GOOD_M = 50;
const WAIT_MS = 15_000;

type Phase = 'ready' | 'finding' | 'sending' | 'done' | 'denied' | 'error';

/** /l/:id/:tok — one big button: the customer sends where the delivery should come. */
export function ShareLocationPage() {
  const bi = useBi();
  const { id = '', tok = '' } = useParams();
  const [info, setInfo] = useState<{ shopName: string; located: boolean } | 'gone' | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [acc, setAcc] = useState<number | null>(null);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => {
    publicGet<{ shopName: string; located: boolean }>('/l/' + id + '/' + tok)
      .then(setInfo)
      .catch(() => setPhase('error'));
    return () => stop.current();
  }, [id, tok]);

  const send = async (p: { lat: number; lng: number; accuracy?: number }) => {
    setPhase('sending');
    try {
      const r = await fetch('/api/l/' + id + '/' + tok, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      if (r.status === 404) return setInfo('gone');
      setPhase(r.ok ? 'done' : 'error');
    } catch {
      setPhase('error');
    }
  };

  const share = () => {
    if (!navigator.geolocation) return setPhase('error');
    setPhase('finding');
    let best: GeolocationPosition | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      if (best) void send({ lat: best.coords.latitude, lng: best.coords.longitude, accuracy: Math.round(best.coords.accuracy) });
      else setPhase('error');
    };
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
        setAcc(Math.round(best.coords.accuracy));
        if (best.coords.accuracy <= GOOD_M) finish();
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          finished = true;
          navigator.geolocation.clearWatch(watch);
          clearTimeout(timer);
          setPhase('denied');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: WAIT_MS },
    );
    const timer = setTimeout(finish, WAIT_MS);
    stop.current = () => {
      finished = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
    };
  };

  if (info === 'gone')
    return (
      <div className="public-page">
        <div className="card public-card">
          <h1 className="title">{bi('This link has ended', 'ಈ ಲಿಂಕ್ ಮುಗಿದಿದೆ')}</h1>
          <p className="muted">{bi('The delivery is over. Ask the shop if anything is wrong.', 'ಡೆಲಿವರಿ ಮುಗಿದಿದೆ. ಏನಾದರೂ ತಪ್ಪಿದ್ದರೆ ಅಂಗಡಿಯನ್ನು ಕೇಳಿ.')}</p>
        </div>
      </div>
    );

  return (
    <div className="public-page">
      <div className="card public-card">
        <div className="bar between m-0">
          <b className="track-shop">{info?.shopName ?? ''}</b>
          <LangSwitch />
        </div>
        {phase === 'done' ? (
          <div className="locate-done">
            <svg className="check-draw" viewBox="0 0 52 52" aria-hidden>
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27 l7 7 l15 -16" />
            </svg>
            <h1 className="title">{bi('Thanks! Your delivery will come here.', 'ಧನ್ಯವಾದ! ನಿಮ್ಮ ಡೆಲಿವರಿ ಇಲ್ಲಿಗೆ ಬರುತ್ತದೆ.')}</h1>
          </div>
        ) : (
          <>
            <h1 className="title">{bi('Where should we deliver?', 'ಎಲ್ಲಿಗೆ ಡೆಲಿವರಿ ಮಾಡಬೇಕು?')}</h1>
            <p className="muted">{bi('Stand at your home and tap the button. Your phone will ask to share your location: allow it.', 'ಮನೆಯಲ್ಲಿ ನಿಂತು ಬಟನ್ ಒತ್ತಿ. ಫೋನ್ ಸ್ಥಳ ಕೇಳುತ್ತದೆ: ಅನುಮತಿಸಿ.')}</p>
            {info && info.located && phase === 'ready' && <div className="msg">{bi('You already sent it. Send again only if it was wrong.', 'ನೀವು ಈಗಾಗಲೇ ಕಳುಹಿಸಿದ್ದೀರಿ. ತಪ್ಪಾಗಿದ್ದರೆ ಮಾತ್ರ ಮತ್ತೆ ಕಳುಹಿಸಿ.')}</div>}
            <button className={'btn primary locate-btn' + (phase === 'finding' || phase === 'sending' ? ' busy' : '')} disabled={phase === 'finding' || phase === 'sending' || !info} onClick={share}>
              📍 {phase === 'finding' ? bi('Finding you…', 'ಹುಡುಕುತ್ತಿದೆ…') + (acc != null ? ' (' + acc + ' m)' : '') : phase === 'sending' ? bi('Sending…', 'ಕಳುಹಿಸುತ್ತಿದೆ…') : bi('Share my location', 'ನನ್ನ ಸ್ಥಳ ಕಳುಹಿಸಿ')}
            </button>
            {phase === 'denied' && <div className="msg err">{bi('Location was not allowed. Allow it for this browser in the phone’s Settings, then tap again.', 'ಸ್ಥಳ ಅನುಮತಿ ಇಲ್ಲ. ಫೋನಿನ ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ಅನುಮತಿಸಿ, ಮತ್ತೆ ಒತ್ತಿ.')}</div>}
            {phase === 'error' && <div className="msg err">{bi('Could not find or send the location. Turn on GPS and try again.', 'ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ ಅಥವಾ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ. GPS ಆನ್ ಮಾಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.')}</div>}
          </>
        )}
      </div>
    </div>
  );
}
