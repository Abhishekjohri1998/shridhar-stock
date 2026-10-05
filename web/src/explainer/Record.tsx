import { useEffect, useRef, useState } from 'react';
import { H, loadFonts, Pen, readPalette, W } from './draw';
import { renderFrame, TOTAL } from './scenes';

declare global {
  interface Window {
    __explainerDuration?: number;
  }
}

type State = 'starting' | 'recording' | 'done' | 'error';

/** MP4 (H.264) where the browser can record it, else WebM. */
function pickType(): string {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  try {
    return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  } catch {
    return '';
  }
}

/**
 * /explainer/record: a hidden page (admin only, no menu link) that plays the explainer from the
 * start on a 1280×720 canvas and records it with the browser's own MediaRecorder.
 * ?lang=en|kn picks the captions; ?to=<url> is where the finished file is POSTed.
 * The status line carries data-state for automation; window.__explainerDuration is the length.
 */
export function RecordPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<State>('starting');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    window.__explainerDuration = TOTAL;
    const q = new URLSearchParams(window.location.search);
    const lang = q.get('lang') === 'kn' ? 'kn' : 'en';
    const to = q.get('to');
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) {
      setState('error');
      setNote('No canvas');
      return;
    }
    const pen = new Pen(ctx, readPalette(), lang);
    let raf = 0;
    let stopped = false;
    let rec: MediaRecorder | null = null;
    const run = async () => {
      await loadFonts();
      if (stopped) return;
      renderFrame(pen, 0);
      const type = pickType();
      const stream = cv.captureStream(30);
      rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        if (stopped) return;
        const blob = new Blob(chunks, { type: rec?.mimeType || type || 'video/webm' });
        setNote(blob.type + ' · ' + Math.round(blob.size / 1024) + ' KB');
        try {
          if (to) {
            const r = await fetch(to, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
            if (!r.ok) throw new Error('Upload answered ' + r.status);
          } else setLink(URL.createObjectURL(blob));
          setState('done');
        } catch (e) {
          setState('error');
          setNote((e as Error).message);
        }
      };
      rec.start(1000);
      setState('recording');
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        renderFrame(pen, Math.min(t, TOTAL));
        if (t >= TOTAL + 0.5) {
          rec?.stop();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    run().catch((e) => {
      setState('error');
      setNote((e as Error).message);
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (rec && rec.state !== 'inactive') rec.stop();
    };
  }, []);

  return (
    <main className="plain-col">
      <canvas ref={canvas} width={W} height={H} className="explainer-record" />
      <p id="explainer-status" data-state={state}>
        {state}
        {note && ' · ' + note}
        {link && (
          <>
            {' · '}
            <a href={link} download="how-it-works">
              Save
            </a>
          </>
        )}
      </p>
    </main>
  );
}
