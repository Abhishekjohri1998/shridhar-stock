import { useState } from 'react';
import type { Ink } from '@stock/core';
import { http } from '../lib/api';
import { InkPad } from './InkPad';
import { useBi } from './ui';

export interface WrittenResult {
  ink: Ink;
  readText: string;
  matches: { itemId: string; confidence: number }[];
  unit?: string | null;
  qty?: number | null;
}

/**
 * "Write instead of type": a ✎ button that opens a writing strip, reads what was written with
 * the same reader as bill lines, and hands back the writing, what it said, and the items it may be.
 * When reading is off or fails, the writing itself is still handed back.
 */
export function WriteToFind({ onResult, label }: { onResult: (r: WrittenResult) => void; label?: string }) {
  const bi = useBi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        ✎ {label ?? bi('Write it', 'ಬರೆಯಿರಿ')}
      </button>
    );
  }
  return (
    <div className="card receipt">
      {error && <div className="msg err">{error}</div>}
      {busy ? (
        <p className="muted">{bi('Reading…', 'ಓದುತ್ತಿದೆ…')}</p>
      ) : (
        <InkPad
          label={bi('Write the item, in Kannada or English', 'ಸಾಮಾನು ಬರೆಯಿರಿ, ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್')}
          doneLabel={'✓ ' + bi('Read it', 'ಓದಿ')}
          onDone={async (ink) => {
            setBusy(true);
            setError('');
            try {
              const r = await http.post<Omit<WrittenResult, 'ink'>>('/read', { ink });
              onResult({ ink, ...r });
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
              onResult({ ink, readText: '', matches: [] });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
        {bi('Close', 'ಮುಚ್ಚಿ')}
      </button>
    </div>
  );
}
