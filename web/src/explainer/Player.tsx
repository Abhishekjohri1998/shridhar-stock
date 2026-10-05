import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useTour } from '../components/Tour';
import { Icon } from '../components/Icon';
import { H, loadFonts, Pen, readPalette, W, type Lang } from './draw';
import { chapterAt, CHAPTERS, renderFrame, STARTS, TOTAL } from './scenes';

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const mmss = (t: number) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

/**
 * The explainer as a video: the canvas, play/pause, a progress bar to seek, the chapters as
 * buttons, and "Try it now" for the chapter on screen. Captions follow the app's language.
 */
export function ExplainerPlayer({ onClose, autoPlay = false, onTry }: { onClose?: () => void; autoPlay?: boolean; onTry?: () => void }) {
  const { lang } = useSession();
  const { start } = useTour();
  const nav = useNavigate();
  const kn = lang === 'kn';
  const canvas = useRef<HTMLCanvasElement>(null);
  const time = useRef(0);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(() => autoPlay && !reducedMotion());
  const pen = useRef<Pen | null>(null);

  const draw = useCallback(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (!pen.current || pen.current.ctx !== ctx) pen.current = new Pen(ctx, readPalette(), lang as Lang);
    pen.current.lang = lang as Lang;
    const k = cv.width / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    renderFrame(pen.current, time.current);
  }, [lang]);

  // Sharp at any size: the canvas's pixels follow its width on screen.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const fit = () => {
      const k = Math.max(0.5, Math.min(2, (cv.clientWidth * (window.devicePixelRatio || 1)) / W));
      const w = Math.round(W * k);
      if (cv.width !== w) {
        cv.width = w;
        cv.height = Math.round(H * k);
      }
      draw();
    };
    fit();
    let ro: ResizeObserver | undefined;
    try {
      ro = new ResizeObserver(fit);
      ro.observe(cv);
    } catch {
      window.addEventListener('resize', fit);
    }
    // The web fonts may arrive after the first frame.
    loadFonts().then(fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [draw]);

  useEffect(() => {
    if (!playing) {
      draw();
      return;
    }
    let raf = 0;
    let last = performance.now();
    let lastShown = 0;
    const tick = (now: number) => {
      time.current = Math.min(TOTAL, time.current + (now - last) / 1000);
      last = now;
      draw();
      if (now - lastShown > 200) {
        lastShown = now;
        setShown(time.current);
      }
      if (time.current >= TOTAL) {
        setShown(TOTAL);
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw]);

  const seek = (t: number) => {
    time.current = Math.max(0, Math.min(TOTAL, t));
    setShown(time.current);
    draw();
  };
  const toggle = () => {
    if (!playing && time.current >= TOTAL - 0.05) seek(0);
    setPlaying(!playing);
  };

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'Escape' && onClose) onClose();
      else if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'INPUT') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [onClose]);

  const here = chapterAt(shown);
  const ch = CHAPTERS[here]!;
  const tryIt = () => {
    setPlaying(false);
    onTry?.();
    nav(ch.route);
    // The screen renders first; the tour then finds its parts.
    setTimeout(() => start(ch.tour), 350);
  };

  return (
    <div className="explainer">
      <div className="explainer-stage" onClick={toggle}>
        <canvas ref={canvas} width={W} height={H} role="img" aria-label={kn ? 'ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ: ಅನಿಮೇಷನ್' : 'How it works: an animation'} />
        {!playing && (
          <span className="explainer-big-play" aria-hidden="true">
            ▶
          </span>
        )}
      </div>
      <div className="explainer-controls">
        <button className="btn small primary" onClick={toggle} aria-label={playing ? (kn ? 'ನಿಲ್ಲಿಸಿ' : 'Pause') : kn ? 'ಪ್ಲೇ' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          className="explainer-seek"
          min={0}
          max={TOTAL}
          step={0.1}
          value={shown}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={kn ? 'ಎಲ್ಲಿಗೆ ಹೋಗಬೇಕು' : 'Seek'}
        />
        <span className="muted explainer-time">
          {mmss(shown)} / {mmss(TOTAL)}
        </span>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label={kn ? 'ಮುಚ್ಚಿ' : 'Close'}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="bar between explainer-now">
        <b>
          {here + 1}. {kn ? ch.title.kn : ch.title.en}
        </b>
        <button className="btn small" onClick={tryIt}>
          {kn ? 'ಈಗ ಪ್ರಯತ್ನಿಸಿ' : 'Try it now'} →
        </button>
      </div>
      <div className="chips explainer-chapters" role="group" aria-label={kn ? 'ಭಾಗಗಳು' : 'Chapters'}>
        {CHAPTERS.map((c, i) => (
          <button key={c.id} className={'chip' + (i === here ? ' on' : '')} onClick={() => seek(STARTS[i]! + 0.01)} aria-current={i === here ? 'step' : undefined}>
            {i + 1}. {kn ? c.title.kn : c.title.en}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The player over the whole screen. `offer` adds a line and "Not now", for the first sign-in. */
export function ExplainerModal({ onClose, offer = false }: { onClose: () => void; offer?: boolean }) {
  const { lang } = useSession();
  const kn = lang === 'kn';
  return (
    <div className="explainer-wrap" onClick={onClose}>
      <div className="explainer-modal" role="dialog" aria-modal="true" aria-label={kn ? 'ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ' : 'How it works'} onClick={(e) => e.stopPropagation()}>
        {offer && (
          <div className="bar between">
            <span className="subtitle m-0">{kn ? 'ಹೊಸಬರೇ? ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ ನೋಡಿ (2½ ನಿಮಿಷ)' : 'New here? Watch how it works (2½ min)'}</span>
            <button className="btn small ghost" onClick={onClose}>
              {kn ? 'ಈಗ ಬೇಡ' : 'Not now'}
            </button>
          </div>
        )}
        <ExplainerPlayer onClose={onClose} autoPlay={!offer} onTry={onClose} />
      </div>
    </div>
  );
}

/** The card on Home that opens the player. */
export function ExplainerCard({ onOpen }: { onOpen: () => void }) {
  const { lang } = useSession();
  const kn = lang === 'kn';
  return (
    <button className="card clickable explainer-card" onClick={onOpen} data-tour="home-explainer">
      <span className="explainer-card-play" aria-hidden="true">
        ▶
      </span>
      <span className="need-text">
        <b>{kn ? 'ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ ನೋಡಿ (2½ ನಿಮಿಷ)' : 'Watch how it works (2½ min)'}</b>
        <span>{kn ? 'ಜನರು ಮತ್ತು ಕೆಲಸ, ಬಿಲ್‌ನಿಂದ ಸ್ಟಾಕ್, ಗೋದಾಮು ಮತ್ತು ಖರೀದಿ' : 'People and roles, a bill through stock, the godown and buying'}</span>
      </span>
    </button>
  );
}

const OFFER_KEY = 'stock.explainer.offered.';

/** Whether the explainer was offered to this person on this device (blocked storage: yes). */
export function explainerOffered(personId: string): boolean {
  try {
    return localStorage.getItem(OFFER_KEY + personId) === '1';
  } catch {
    return true;
  }
}

export function markExplainerOffered(personId: string): void {
  try {
    localStorage.setItem(OFFER_KEY + personId, '1');
  } catch {
    /* not remembered; fine */
  }
}
