import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface SelectOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Plain words for the button and for typing a letter to jump; defaults to the label's text. */
  text?: string;
  hint?: ReactNode;
}

const PHONE = '(max-width: 639px)';
const isPhone = () => {
  try {
    return window.matchMedia(PHONE).matches;
  } catch {
    return false;
  }
};

/**
 * A dropdown that opens where it was tapped. Inside the Android app's WebView a native
 * `<select>` draws its list at the top of the screen, far from the field; this one opens right
 * below the button, or above it when there is no room below, and on a phone as a sheet from the
 * bottom, the way the "More" menu does.
 *
 * Arrow keys move, Enter or Space picks, Escape or a tap outside closes. The list is drawn in a
 * portal so a card that scrolls sideways cannot clip it.
 */
export function Select<V extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: V;
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  className?: string;
  disabled?: boolean;
  placeholder?: ReactNode;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const chosen = options.find((o) => o.value === value);

  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  }, []);

  const measure = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const below = window.innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const want = Math.min(320, options.length * 48 + 12);
    const width = Math.max(b.width, 180);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - width - 8));
    // Below unless it does not fit there and fits better above.
    if (below >= want || below >= above) setPlace({ left, top: b.bottom + 4, width, maxHeight: Math.max(120, Math.min(want, below)) });
    else setPlace({ left, bottom: window.innerHeight - b.top + 4, width, maxHeight: Math.min(want, above) });
  }, [options.length]);

  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setSheet(isPhone());
    measure();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (open && !sheet) measure();
  }, [open, sheet, measure]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    // The page scrolling moves the button: follow it. A resize can change phone to tablet: close.
    const follow = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) measure();
    };
    const resize = () => close(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', resize);
    };
  }, [open, close, measure]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[data-i="' + active + '"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (v: V) => {
    if (v !== value) onChange(v);
    close();
  };

  const key = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(last, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o.value);
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key.length === 1) {
      // A letter jumps to the next option starting with it.
      const k = e.key.toLowerCase();
      const n = options.length;
      for (let step = 1; step <= n; step++) {
        const j = (active + step) % n;
        if ((options[j]!.text ?? String(options[j]!.value)).toLowerCase().startsWith(k)) {
          setActive(j);
          break;
        }
      }
    }
  };

  const items = (
    <div className="select-list" role="listbox" id={id} aria-label={ariaLabel} onKeyDown={key} tabIndex={-1}>
      {options.map((o, i) => (
        <div
          key={o.value}
          data-i={i}
          role="option"
          aria-selected={o.value === value}
          className={'select-opt' + (o.value === value ? ' on' : '') + (i === active ? ' active' : '')}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(o.value)}
        >
          <span className="select-opt-text">
            {o.label}
            {o.hint && <span className="muted"> {o.hint}</span>}
          </span>
          {o.value === value && <Icon name="check" size={18} />}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={'select-btn' + (className ? ' ' + className : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={key}
      >
        <span className="select-value">{chosen ? chosen.label : <span className="muted">{placeholder ?? '—'}</span>}</span>
        <Icon name="chevronDown" size={18} className="select-caret" />
      </button>
      {open &&
        createPortal(
          sheet ? (
            <div className="sheet-wrap" onClick={() => close()}>
              <div className="sheet select-sheet" ref={list} onClick={(e) => e.stopPropagation()}>
                {ariaLabel && <div className="side-head">{ariaLabel}</div>}
                {items}
              </div>
            </div>
          ) : (
            place && (
              <div
                ref={list}
                className="select-pop"
                style={{ left: place.left, top: place.top, bottom: place.bottom, minWidth: place.width, maxHeight: place.maxHeight }}
              >
                {items}
              </div>
            )
          ),
          document.body,
        )}
    </>
  );
}
