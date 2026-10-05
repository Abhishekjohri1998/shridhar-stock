import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import { TOURS, type TourDef } from '../tours';

/**
 * The guided tour: one step at a time, a spotlight on a part of the screen and a short card that
 * says what it is, what it does, and what happens if you tap it. Next, Back and Skip.
 *
 * Steps find their part of the screen by `data-tour="…"`. A step whose part is not on the screen
 * right now (an empty list, a closed form) shows its card in the middle instead, so a tour never
 * gets stuck. No library: a fixed box with a huge shadow makes the spotlight.
 */

interface TourApi {
  /** Starts a tour by id. `onClose` runs when it ends, by Finish or by Skip. */
  start: (id: string, onClose?: () => void) => void;
  active: string | null;
}

const Ctx = createContext<TourApi>({ start: () => undefined, active: null });

export function useTour(): TourApi {
  return useContext(Ctx);
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The first element for a target that is actually shown: the side menu and the phone's bottom bar
 * both carry the same names, and only one of them is on the screen.
 */
function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-tour="' + target + '"]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return null;
}

/** Where the target is now, padded a little; null when it is not on the screen. */
function measure(target: string | undefined): DOMRect | null {
  const el = findTarget(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = 6;
  return new DOMRect(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [tour, setTour] = useState<{ def: TourDef; onClose?: () => void } | null>(null);
  const start = useCallback((id: string, onClose?: () => void) => {
    const def = TOURS[id];
    if (def) setTour({ def, onClose });
  }, []);
  const close = useCallback(() => {
    setTour((t) => {
      t?.onClose?.();
      return null;
    });
  }, []);
  const api = useMemo(() => ({ start, active: tour?.def.id ?? null }), [start, tour]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {tour && <TourOverlay key={tour.def.id} def={tour.def} onClose={close} />}
    </Ctx.Provider>
  );
}

function TourOverlay({ def, onClose }: { def: TourDef; onClose: () => void }) {
  const { lang } = useSession();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [wide, setWide] = useState(() => window.innerWidth >= 640);
  const card = useRef<HTMLDivElement>(null);
  const step = def.steps[i]!;
  const last = i === def.steps.length - 1;
  const kn = lang === 'kn';

  // Find the step's part of the screen, waiting a moment for a screen that is still loading.
  useLayoutEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const find = () => {
      const el = findTarget(step.target);
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        timer = setTimeout(() => setRect(measure(step.target)), reducedMotion() ? 0 : 260);
      } else if (step.target && tries++ < 10) {
        timer = setTimeout(find, 100);
      } else {
        setRect(null);
      }
    };
    setRect(null);
    find();
    return () => clearTimeout(timer);
  }, [step]);

  // Follow the target when the page scrolls or the window changes size.
  useEffect(() => {
    const follow = () => {
      setWide(window.innerWidth >= 640);
      setRect(measure(step.target));
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [step]);

  useEffect(() => {
    card.current?.focus();
  }, [i]);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(def.steps.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [def, onClose]);

  // The card sits below the target if there is room, else above; on a phone, along the bottom.
  const style: React.CSSProperties = {};
  if (rect && wide) {
    const w = Math.min(380, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - w - 16));
    style.width = w;
    style.left = left;
    if (window.innerHeight - rect.bottom > 230) style.top = rect.bottom + 12;
    else style.bottom = Math.max(16, window.innerHeight - rect.top + 12);
  }
  const where = rect ? (wide ? 'at' : 'bottom') : 'center';
  const t = (x: { en: string; kn: string }) => (kn ? x.kn : x.en);
  return (
    <div className="tour" role="presentation">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} aria-hidden="true" />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={card}
        className={'tour-card ' + where}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
      >
        <div className="tour-top">
          <span className="muted">
            {t(def.title)} · {i + 1}/{def.steps.length}
          </span>
          <button className="btn small ghost" onClick={onClose}>
            {kn ? 'ಬಿಡಿ' : 'Skip'}
          </button>
        </div>
        <h2 id="tour-title" className="subtitle m-0">
          {t(step.title)}
        </h2>
        <p className="tour-line">{t(step.what)}</p>
        <p className="tour-line">{t(step.does)}</p>
        <p className="tour-line tour-tap">
          <b>{kn ? 'ಒತ್ತಿದರೆ:' : 'If you tap it:'}</b> {t(step.tap)}
        </p>
        <div className="tour-dots" aria-hidden="true">
          {def.steps.map((_, n) => (
            <span key={n} className={n === i ? 'on' : ''} />
          ))}
        </div>
        <div className="bar between">
          <button className="btn" onClick={() => setI(i - 1)} disabled={i === 0}>
            ‹ {kn ? 'ಹಿಂದೆ' : 'Back'}
          </button>
          <button className="btn primary" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? (kn ? 'ಮುಗಿಸಿ' : 'Finish') : (kn ? 'ಮುಂದೆ' : 'Next') + ' ›'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The "?" button: replays the tour for the screen you are on. Hidden where there is none. */
export function TourButton({ tourId }: { tourId: string | null }) {
  const { start } = useTour();
  const { lang } = useSession();
  if (!tourId || !TOURS[tourId]) return null;
  const label = lang === 'kn' ? 'ಈ ಪುಟದ ಪರಿಚಯ' : 'Show me this screen';
  return (
    <button className="icon-btn" onClick={() => start(tourId)} aria-label={label} title={label} data-tour="help-button">
      <span aria-hidden="true">?</span>
    </button>
  );
}

const SEEN_KEY = 'stock.tour.first.';

/** Whether this person has had their first tour for this role on this device. */
export function firstTourSeen(personId: string, role: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY + personId + '.' + role) === '1';
  } catch {
    // Storage blocked (a private window): do not keep popping the tour up.
    return true;
  }
}

export function markFirstTourSeen(personId: string, role: string): void {
  try {
    localStorage.setItem(SEEN_KEY + personId + '.' + role, '1');
  } catch {
    /* not remembered; fine */
  }
}
