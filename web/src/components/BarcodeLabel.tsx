import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ean13Modules } from '@stock/core';
import { inApp, tellApp, LABELS_PRINTED_EVENT } from '../lib/inApp';
import { useBi } from './ui';

/** What goes on one label: the code, the item's names and the unit's price. */
export type LabelInfo = { code: string; nameEn: string; nameKn: string; price: number | null; unit: string };

/** The bars as SVG: one rect per run of black modules, a quiet zone either side, digits under. */
export function BarcodeSvg({ code, height = 48 }: { code: string; height?: number }) {
  const modules = ean13Modules(code);
  const quiet = 9;
  const rects: { x: number; w: number }[] = [];
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== '1') { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === '1') j++;
    rects.push({ x: quiet + i, w: j - i });
    i = j;
  }
  const width = modules.length + quiet * 2;
  const human = code[0] + '  ' + code.slice(1, 7) + '  ' + code.slice(7);
  return (
    <svg viewBox={'0 0 ' + width + ' ' + (height + 12)} role="img" aria-label={code} className="barcode-svg">
      <rect x="0" y="0" width={width} height={height + 12} fill="#fff" />
      {rects.map((r) => <rect key={r.x} x={r.x} y="0" width={r.w} height={height} fill="#000" />)}
      <text x={width / 2} y={height + 10} textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#000">{human}</text>
    </svg>
  );
}

function priceLine(info: LabelInfo): string {
  return info.price != null && info.price > 0 ? '₹' + info.price + (info.unit ? ' / ' + info.unit : '') : '';
}

/**
 * Print labels for one barcode: a preview, how many, and where to print. Inside the billing app
 * (the tablet's Stock tab) they go to the shop's Bluetooth receipt printer through the app; in a
 * browser, a sheet of stickers through the browser's own print (A4, 3 x 8, 63.5 x 33.9 mm).
 */
export function BarcodeLabelDialog({ info, onClose }: { info: LabelInfo; onClose: () => void }) {
  const bi = useBi();
  const [copies, setCopies] = useState('1');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const n = Math.max(1, Math.min(200, Math.floor(Number(copies)) || 1));
  const price = priceLine(info);
  const name = info.nameEn || info.nameKn;

  // The sheet is drawn, printed, then put away.
  useEffect(() => {
    if (!sheet) return;
    const done = () => setSheet(false);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [sheet]);

  const toPrinter = () => {
    setBusy(true);
    setStatus(null);
    let answered = false;
    const onAnswer = (e: Event) => {
      answered = true;
      window.removeEventListener(LABELS_PRINTED_EVENT, onAnswer);
      const d = (e as CustomEvent<{ ok: boolean; error?: string }>).detail;
      setBusy(false);
      setStatus(d?.ok ? { ok: true, text: bi('Printed', 'ಮುದ್ರಿಸಲಾಗಿದೆ') + ' · ' + n } : { ok: false, text: d?.error || bi('Could not print', 'ಮುದ್ರಿಸಲಾಗಲಿಲ್ಲ') });
    };
    window.addEventListener(LABELS_PRINTED_EVENT, onAnswer);
    tellApp({
      type: 'print-labels',
      copies: n,
      labels: [{ code: info.code, modules: ean13Modules(info.code), title: info.nameEn || info.code, price: price.replace('₹', 'Rs ') }],
    });
    window.setTimeout(() => {
      if (answered) return;
      window.removeEventListener(LABELS_PRINTED_EVENT, onAnswer);
      setBusy(false);
      setStatus({ ok: false, text: bi('The app did not answer. Update the billing app (build 95 or later) to print labels.', 'ಆ್ಯಪ್ ಉತ್ತರಿಸಲಿಲ್ಲ. ಲೇಬಲ್ ಮುದ್ರಿಸಲು ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್ ಅಪ್‌ಡೇಟ್ ಮಾಡಿ (ಬಿಲ್ಡ್ 95 ಅಥವಾ ನಂತರ).') });
    }, 20000);
  };

  const label = (
    <div className="barcode-label">
      <b className="bl-name">{name}</b>
      {info.nameEn && info.nameKn ? <span className="bl-other">{info.nameKn}</span> : null}
      {price ? <span className="bl-price">{price}</span> : null}
      <BarcodeSvg code={info.code} />
    </div>
  );

  // On the page's body: a card on the item page makes its own layer, and the save bar covered it.
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={bi('Print barcode label', 'ಬಾರ್‌ಕೋಡ್ ಲೇಬಲ್ ಮುದ್ರಿಸಿ')}>
      <div className="modal card">
        <h3>{bi('Print barcode label', 'ಬಾರ್‌ಕೋಡ್ ಲೇಬಲ್ ಮುದ್ರಿಸಿ')}</h3>
        <div className="barcode-preview">{label}</div>
        <label className="field">
          <span>{bi('How many labels', 'ಎಷ್ಟು ಲೇಬಲ್')}</span>
          <input inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </label>
        {status && <p className={status.ok ? 'ok' : 'error'}>{status.text}</p>}
        <div className="bar">
          {inApp() ? (
            <button type="button" className="btn primary" disabled={busy} onClick={toPrinter}>
              🖨 {busy ? bi('Printing…', 'ಮುದ್ರಿಸಲಾಗುತ್ತಿದೆ…') : bi('Print on the receipt printer', 'ರಸೀದಿ ಪ್ರಿಂಟರ್‌ನಲ್ಲಿ ಮುದ್ರಿಸಿ')}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => setSheet(true)}>
              🖨 {bi('Print sticker sheet', 'ಸ್ಟಿಕ್ಕರ್ ಹಾಳೆ ಮುದ್ರಿಸಿ')}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>{bi('Close', 'ಮುಚ್ಚಿ')}</button>
        </div>
        {!inApp() && <p className="muted mb-0">{bi('A4 sticker sheet, 3 across and 8 down (63.5 x 33.9 mm). Choose "Actual size" in the print window.', 'A4 ಸ್ಟಿಕ್ಕರ್ ಹಾಳೆ, 3 ಅಡ್ಡ ಮತ್ತು 8 ಉದ್ದ (63.5 x 33.9 ಮಿಮೀ). ಪ್ರಿಂಟ್ ವಿಂಡೋದಲ್ಲಿ "Actual size" ಆರಿಸಿ.')}</p>}
      </div>
      {sheet && createPortal(<div className="label-sheet">{Array.from({ length: n }, (_, i) => <div key={i} className="label-cell">{label}</div>)}</div>, document.body)}
    </div>,
    document.body,
  );
}
