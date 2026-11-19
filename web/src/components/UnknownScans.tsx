import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { itemMatches, pickName, sellUnitOf, type Item, type UnknownScan } from '@stock/core';
import { http } from '../lib/api';
import { useLive } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { Select } from './Select';
import { useBi } from './ui';

/**
 * Barcodes the counter scanned that no item has yet. Each one is a product the shop sells (or a
 * new packet of one): link it to its item and the next scan bills it, or start a new item with
 * the code already on it. Hidden when there are none.
 */
export function UnknownScans({ items }: { items: Item[] }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('items');
  const { value, reload } = useLoad(() => http.get<{ scans: UnknownScan[] }>('/admin/unknown-scans').then((r) => r.scans), [live]);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Item | null>(null);
  const [unit, setUnit] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const found = useMemo(
    () => (q.trim() ? items.filter((i) => i.active && itemMatches(i, q)).slice(0, 6) : []),
    [items, q],
  );
  const scans = value ?? [];
  if (!scans.length) return null;

  const start = (code: string) => {
    setOpen(open === code ? null : code);
    setQ('');
    setChosen(null);
    setUnit('');
    setError('');
  };
  const choose = (item: Item) => {
    setChosen(item);
    setUnit(sellUnitOf(item).code);
  };
  const link = async (code: string) => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      await http.post('/admin/unknown-scans/' + encodeURIComponent(code) + '/link', { itemId: chosen.id, unit });
      setOpen(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (code: string) => {
    await http.del('/admin/unknown-scans/' + encodeURIComponent(code)).catch(() => undefined);
    reload();
  };
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });

  return (
    <div className="card" data-tour="inventory-unknown-scans">
      <h2 className="subtitle mt-0">
        {bi('Scanned, not linked', 'ಸ್ಕ್ಯಾನ್ ಆಗಿದೆ, ಜೋಡಿಸಿಲ್ಲ')} ({scans.length})
      </h2>
      <p className="muted">
        {bi(
          'The counter scanned these barcodes, but no item has them yet. Link each one to its item, and the next scan bills it.',
          'ಕೌಂಟರ್‌ನಲ್ಲಿ ಈ ಬಾರ್‌ಕೋಡ್‌ಗಳು ಸ್ಕ್ಯಾನ್ ಆಗಿವೆ, ಆದರೆ ಯಾವ ಸಾಮಾನಿಗೂ ಇಲ್ಲ. ಪ್ರತಿಯೊಂದನ್ನು ಅದರ ಸಾಮಾನಿಗೆ ಜೋಡಿಸಿ; ಮುಂದಿನ ಸ್ಕ್ಯಾನ್ ಬಿಲ್ ಆಗುತ್ತದೆ.',
        )}
      </p>
      {scans.map((s) => (
        <div key={s.code} className="unit">
          <div className="unit-head">
            <b>{s.code}</b>
            <span className="muted">
              {bi(s.count + (s.count === 1 ? ' scan' : ' scans') + ', last ' + when(s.lastAt), s.count + ' ಸ್ಕ್ಯಾನ್, ಕೊನೆಯದು ' + when(s.lastAt))}
            </span>
          </div>
          <div className="bar mb-0">
            <button type="button" className="btn small primary" onClick={() => start(s.code)}>
              {bi('Link to item', 'ಸಾಮಾನಿಗೆ ಜೋಡಿಸಿ')}
            </button>
            <Link className="btn small" to={'/admin/inventory/new?barcode=' + encodeURIComponent(s.code)}>
              + {bi('New item', 'ಹೊಸ ಸಾಮಾನು')}
            </Link>
            <button type="button" className="btn small ghost" onClick={() => void dismiss(s.code)}>
              {bi('Dismiss', 'ತೆಗೆಯಿರಿ')}
            </button>
          </div>
          {open === s.code && (
            <div className="mt-14">
              <input
                className="grow"
                autoFocus
                value={q}
                placeholder={bi('Find the item', 'ಸಾಮಾನು ಹುಡುಕಿ')}
                aria-label={bi('Find the item', 'ಸಾಮಾನು ಹುಡುಕಿ')}
                onChange={(e) => {
                  setQ(e.target.value);
                  setChosen(null);
                }}
              />
              {!chosen && found.length > 0 && (
                <div className="bar">
                  {found.map((i) => (
                    <button key={i.id} type="button" className="chip" onClick={() => choose(i)}>
                      {pickName(i.nameEn, i.nameKn, lang)}
                    </button>
                  ))}
                </div>
              )}
              {chosen && (
                <div className="bar mb-0">
                  <b>{pickName(chosen.nameEn, chosen.nameKn, lang)}</b>
                  <Select
                    className="w-auto"
                    value={unit}
                    onChange={setUnit}
                    aria-label={bi('Unit this barcode is on', 'ಈ ಬಾರ್‌ಕೋಡ್ ಇರುವ ಘಟಕ')}
                    options={chosen.units.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.label || u.code }))}
                  />
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void link(s.code)}>
                    {bi('Link', 'ಜೋಡಿಸಿ')}
                  </button>
                </div>
              )}
              {error && <div className="msg err">{error}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
