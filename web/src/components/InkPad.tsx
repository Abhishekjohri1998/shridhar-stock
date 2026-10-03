import { useEffect, useRef, useState } from 'react';
import type { Ink } from '@stock/core';

/**
 * A strip to write on with a finger or stylus. Strokes come out in the billing app's own format
 * ([x0, y0, x1, y1, ...]), so writing here and writing on the billing tablet are the same thing.
 *
 * When a pen has been seen, touches from a finger or palm are ignored, as the billing pad does.
 */
export function InkPad({ onDone, height = 110, label, doneLabel = '✓ Read it' }: { onDone: (ink: Ink) => void; height?: number; label?: string; doneLabel?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<number[][]>([]);
  const current = useRef<number[] | null>(null);
  const sawPen = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = canvas.current!;
    const fit = () => setWidth(Math.max(200, Math.floor(el.parentElement!.clientWidth)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const draw = () => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(el).color;
    for (const s of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      ctx.beginPath();
      ctx.moveTo(s[0]!, s[1]!);
      for (let i = 2; i + 1 < s.length; i += 2) ctx.lineTo(s[i]!, s[i + 1]!);
      if (s.length === 2) ctx.lineTo(s[0]! + 0.1, s[1]!);
      ctx.stroke();
    }
  };
  useEffect(draw, [width, height]);

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10] as const;
  };
  const rejected = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') sawPen.current = true;
    return sawPen.current && e.pointerType === 'touch';
  };

  return (
    <div className="inkpad">
      {label && <div className="muted mb-4">{label}</div>}
      <canvas
        ref={canvas}
        style={{ width, height, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (rejected(e)) return;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* fine without: the stroke still draws */
          }
          current.current = [...at(e)];
          draw();
        }}
        onPointerMove={(e) => {
          if (!current.current || rejected(e)) return;
          current.current.push(...at(e));
          draw();
        }}
        onPointerUp={() => {
          if (!current.current) return;
          strokes.current.push(current.current);
          current.current = null;
          setEmpty(false);
          draw();
        }}
      />
      <div className="bar mt-6">
        <button type="button" className="btn primary small" disabled={empty} onClick={() => onDone({ w: width, h: height, strokes: strokes.current.slice() })}>
          {doneLabel}
        </button>
        <button
          type="button"
          className="btn small"
          disabled={empty}
          onClick={() => {
            strokes.current = [];
            setEmpty(true);
            draw();
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
