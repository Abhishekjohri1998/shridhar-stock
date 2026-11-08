import { useState } from 'react';
import { api, download } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';
import { useBi, when } from '../../components/ui';

const FORMAT = 'shridhar-stock-backup';

/** Reads a picked file as text; FileReader too, for an older Android WebView with no File.text(). */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}

const stamp = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const mb = (n: number) => (n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1) + ' MB';

/**
 * Setup → Settings: download everything as one file, and put a file back. A restore saves what is
 * there now on the server first, asks for RESTORE typed out, and reloads the app afterwards.
 */
export function BackupCard() {
  const bi = useBi();
  const { lang } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<{ name: string; text: string; exportedAt?: string; counts: Record<string, number> } | null>(null);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const { value: safety } = useLoad(() => api.backups(), [done]);

  const guard = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    setPicked(null);
    setTyped('');
    setError('');
    if (!file) return;
    let text = '';
    let parsed: { format?: unknown; exportedAt?: string; counts?: Record<string, number>; collections?: Record<string, unknown[]> } | null = null;
    try {
      text = await readText(file);
      parsed = JSON.parse(text);
    } catch {
      setError(bi('This file is damaged or is not a backup (it could not be read). Nothing was changed.', 'ಈ ಫೈಲ್ ಹಾಳಾಗಿದೆ ಅಥವಾ ಬ್ಯಾಕಪ್ ಅಲ್ಲ (ಓದಲಾಗಲಿಲ್ಲ). ಏನೂ ಬದಲಾಗಿಲ್ಲ.'));
      return;
    }
    if (!parsed || parsed.format !== FORMAT || typeof parsed.collections !== 'object') {
      setError(bi('This is not a stock backup file. Nothing was changed.', 'ಇದು ಸ್ಟಾಕ್ ಬ್ಯಾಕಪ್ ಫೈಲ್ ಅಲ್ಲ. ಏನೂ ಬದಲಾಗಿಲ್ಲ.'));
      return;
    }
    const counts = parsed.counts ?? Object.fromEntries(Object.entries(parsed.collections ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
    setPicked({ name: file.name, text, exportedAt: parsed.exportedAt, counts });
  };

  const restore = () =>
    guard(async () => {
      if (!picked) return;
      const r = await api.restore(picked.text);
      setPicked(null);
      setDone(r.safety);
      // Everything changed, the people too: start the app again from the restored data.
      setTimeout(() => window.location.reload(), 1500);
    });

  const n = (k: string) => picked?.counts[k] ?? 0;

  return (
    <div className="card" data-tour="settings-backup">
      <h2 className="subtitle mt-0">{bi('Backup and restore', 'ಬ್ಯಾಕಪ್ ಮತ್ತು ಮರುಸ್ಥಾಪನೆ')}</h2>
      <p>
        {bi(
          'One file with everything in stock: items, stock, every movement, places, people and their PINs, suppliers, carriers, orders, bills and settings. Keep it somewhere safe; anyone with it can see the shop’s data.',
          'ಸ್ಟಾಕ್‌ನ ಎಲ್ಲವೂ ಒಂದೇ ಫೈಲ್‌ನಲ್ಲಿ: ಸಾಮಾನು, ಸ್ಟಾಕ್, ಪ್ರತಿ ಚಲನೆ, ಸ್ಥಳಗಳು, ಜನರು ಮತ್ತು ಅವರ PIN, ಪೂರೈಕೆದಾರರು, ಸಾಗಣೆದಾರರು, ಆರ್ಡರ್‌ಗಳು, ಬಿಲ್‌ಗಳು ಮತ್ತು ಸೆಟ್ಟಿಂಗ್ಸ್. ಸುರಕ್ಷಿತವಾಗಿ ಇಡಿ; ಇದು ಇರುವವರಿಗೆ ಅಂಗಡಿಯ ಮಾಹಿತಿ ಕಾಣುತ್ತದೆ.',
        )}
      </p>
      {error && <div className="msg err">{error}</div>}
      {done && (
        <div className="msg ok">
          ✓ {bi('Restored. What was there before is saved on the server as ', 'ಮರುಸ್ಥಾಪಿಸಲಾಯಿತು. ಹಿಂದಿನದು ಸರ್ವರ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ: ')}
          {done}. {bi('Reloading…', 'ಮತ್ತೆ ತೆರೆಯುತ್ತಿದೆ…')}
        </div>
      )}
      <div className="bar">
        <button className="btn primary" disabled={busy} onClick={() => guard(() => download('/admin/backup', 'stock-backup-' + stamp() + '.json'))}>
          ⬇ {bi('Download a backup', 'ಬ್ಯಾಕಪ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ')}
        </button>
      </div>

      <h3 className="subtitle">{bi('Restore from backup', 'ಬ್ಯಾಕಪ್‌ನಿಂದ ಮರುಸ್ಥಾಪಿಸಿ')}</h3>
      <p className="muted">
        {bi(
          'Replaces ALL stock data with the file’s. Before that, what is there now is saved on the server, so it can be downloaded below and put back.',
          'ಎಲ್ಲಾ ಸ್ಟಾಕ್ ಮಾಹಿತಿಯನ್ನು ಫೈಲ್‌ನದರಿಂದ ಬದಲಾಯಿಸುತ್ತದೆ. ಅದಕ್ಕೂ ಮೊದಲು ಈಗ ಇರುವುದನ್ನು ಸರ್ವರ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗುತ್ತದೆ; ಕೆಳಗೆ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ ಮತ್ತೆ ಹಾಕಬಹುದು.',
        )}
      </p>
      <label className="field">
        <span>{bi('Pick the backup file (.json)', 'ಬ್ಯಾಕಪ್ ಫೈಲ್ ಆರಿಸಿ (.json)')}</span>
        {/* No narrow accept list: some Android pickers grey out .json files they do not know the type of. */}
        <input key={fileKey} type="file" accept=".json,application/json,text/plain,application/octet-stream" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {picked && (
        <div className="banner warn">
          <div>
            {picked.name}
            {picked.exportedAt ? ' · ' + bi('made', 'ಮಾಡಿದ್ದು') + ' ' + when(picked.exportedAt, lang) : ''}
          </div>
          <div>
            {bi('Items', 'ಸಾಮಾನು')} {n('items')} · {bi('movements', 'ಚಲನೆಗಳು')} {n('stockmoves')} · {bi('people', 'ಜನರು')} {n('people')} · {bi('orders', 'ಆರ್ಡರ್')} {n('pos')} · {bi('bills', 'ಬಿಲ್')} {n('bills')}
          </div>
          <label className="field">
            <span>{bi('Type RESTORE to replace everything with this file', 'ಎಲ್ಲವನ್ನೂ ಈ ಫೈಲ್‌ನಿಂದ ಬದಲಾಯಿಸಲು RESTORE ಎಂದು ಟೈಪ್ ಮಾಡಿ')}</span>
            <input value={typed} autoCapitalize="characters" autoComplete="off" onChange={(e) => setTyped(e.target.value)} placeholder="RESTORE" />
          </label>
          <div className="bar">
            <button className="btn danger" disabled={busy || typed.trim().toUpperCase() !== 'RESTORE'} onClick={restore}>
              {busy ? bi('Restoring…', 'ಮರುಸ್ಥಾಪಿಸುತ್ತಿದೆ…') : bi('Restore from backup', 'ಬ್ಯಾಕಪ್‌ನಿಂದ ಮರುಸ್ಥಾಪಿಸಿ')}
            </button>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setPicked(null);
                setTyped('');
                setFileKey((k) => k + 1);
              }}
            >
              {bi('Cancel', 'ರದ್ದು')}
            </button>
          </div>
        </div>
      )}

      {safety && safety.length > 0 && (
        <>
          <h3 className="subtitle">{bi('Saved before each restore', 'ಪ್ರತಿ ಮರುಸ್ಥಾಪನೆಗೂ ಮೊದಲು ಉಳಿಸಿದ್ದು')}</h3>
          {safety.map((s) => (
            <div className="bar" key={s.name}>
              <span className="grow">
                {when(s.at, lang)} · {mb(s.size)}
              </span>
              <button className="btn small" onClick={() => guard(() => download('/admin/backups/' + encodeURIComponent(s.name), s.name))}>
                ⬇ {bi('Download', 'ಡೌನ್‌ಲೋಡ್')}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
