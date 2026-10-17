import { useEffect, useRef, useState } from 'react';
import { calc } from '@stock/core';
import { useBi } from './ui';

/** A number box: one typed as a number, or with a numeric keyboard. */
function isNumberBox(el: Element | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return false;
  return el.type === 'number' || el.inputMode === 'decimal' || el.inputMode === 'numeric';
}

/** The number box the person was last in, so "Put in box" knows where to write. */
let lastBox: HTMLInputElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    if (isNumberBox(e.target as Element)) lastBox = e.target as HTMLInputElement;
  });
}

/** Writes into a React-controlled input the way typing would, so its onChange runs. */
function writeInto(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '%', '+'] as const;

/**
 * The 🧮 button in the top bar and its pop-up: + − × ÷, %, decimals, brackets typed in. A long
 * press on any number box opens it too, aimed at that box. The sum is worked out by `calc`
 * (core), a small parser: nothing is ever run as code.
 */
export function CalculatorButton() {
  const bi = useBi();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  const openFor = (box: HTMLInputElement | null) => {
    setTarget(box && document.contains(box) ? box : null);
    setOpen(true);
  };
  // A long press (0.6 s, without moving) on a number box opens the calculator for that box.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let at: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (!isNumberBox(e.target as Element)) return;
      const box = e.target as HTMLInputElement;
      at = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => openFor(box), 600);
    };
    const move = (e: PointerEvent) => {
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) clearTimeout(timer);
    };
    const up = () => {
      clearTimeout(timer);
      at = null;
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
  }, []);
  return (
    <>
      <button className="icon-btn calc-btn" onClick={() => openFor(lastBox)} aria-label={bi('Calculator', 'ಕ್ಯಾಲ್ಕುಲೇಟರ್')} title={bi('Calculator', 'ಕ್ಯಾಲ್ಕುಲೇಟರ್')} data-tour="calculator">
        <span aria-hidden="true">🧮</span>
      </button>
      {open && <CalculatorPop target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

function CalculatorPop({ target, onClose }: { target: HTMLInputElement | null; onClose: () => void }) {
  const bi = useBi();
  const [text, setText] = useState(() => (target?.value && calc(target.value) != null ? target.value : ''));
  const [note, setNote] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const result = text.trim() ? calc(text) : null;
  const shown = result == null ? '' : String(result);
  useEffect(() => {
    field.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const press = (k: string) => {
    setNote('');
    setText((t) => t + (['÷', '×', '−', '+'].includes(k) ? ' ' + k + ' ' : k));
  };
  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
      setNote(bi('Copied', 'ಕಾಪಿ ಆಯಿತು'));
    } catch {
      setNote(bi('Could not copy: write it in by hand', 'ಕಾಪಿ ಆಗಲಿಲ್ಲ: ಕೈಯಲ್ಲಿ ಬರೆಯಿರಿ'));
    }
  };
  const insert = () => {
    if (!shown || !target) return;
    writeInto(target, shown);
    onClose();
  };
  return (
    <div className="sheet-wrap calc-wrap" onClick={onClose}>
      <div className="sheet calc" role="dialog" aria-modal="true" aria-label={bi('Calculator', 'ಕ್ಯಾಲ್ಕುಲೇಟರ್')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top">
          <b>🧮 {bi('Calculator', 'ಕ್ಯಾಲ್ಕುಲೇಟರ್')}</b>
          <button className="btn ghost small" onClick={onClose} aria-label={bi('Close', 'ಮುಚ್ಚಿ')}>
            ✕
          </button>
        </div>
        <input
          ref={field}
          className="calc-in"
          value={text}
          onChange={(e) => {
            setNote('');
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown) setText(shown);
          }}
          aria-label={bi('Sum', 'ಲೆಕ್ಕ')}
          placeholder="540 ÷ 60"
        />
        <div className={'calc-out' + (text.trim() && result == null ? ' bad' : '')} aria-live="polite">
          {text.trim() ? (result == null ? bi('Not a sum yet', 'ಇನ್ನೂ ಲೆಕ್ಕ ಆಗಿಲ್ಲ') : '= ' + shown) : ' '}
        </div>
        <div className="calc-keys">
          {KEYS.map((k) => (
            <button key={k} type="button" className={'btn calc-key' + (/[0-9.]/.test(k) ? '' : ' op')} onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button type="button" className="btn calc-key" onClick={() => setText((t) => t.trimEnd().slice(0, -1).trimEnd())} aria-label={bi('Back', 'ಹಿಂದೆ')}>
            ⌫
          </button>
          <button type="button" className="btn calc-key" onClick={() => setText('')}>
            C
          </button>
          <button type="button" className="btn calc-key op" onClick={() => shown && setText(shown)}>
            =
          </button>
          <button type="button" className="btn calc-key" onClick={copy} disabled={!shown}>
            {bi('Copy', 'ಕಾಪಿ')}
          </button>
        </div>
        {note && <div className="muted">{note}</div>}
        <button className="btn primary calc-put" onClick={insert} disabled={!shown || !target}>
          {target ? bi('Put in box', 'ಬಾಕ್ಸ್‌ಗೆ ಹಾಕಿ') : bi('Tap a number box first to put it there', 'ಹಾಕಲು ಮೊದಲು ಸಂಖ್ಯೆ ಬಾಕ್ಸ್ ಒತ್ತಿ')}
        </button>
      </div>
    </div>
  );
}
