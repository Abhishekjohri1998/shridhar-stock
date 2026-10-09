import type { DeliveryStep, DeliveryStepKey } from '@stock/core';
import { clockText } from '../lib/share';

const WORDS: Record<DeliveryStepKey, [string, string]> = {
  packed: ['Order packed', 'ಆರ್ಡರ್ ಪ್ಯಾಕ್ ಆಯಿತು'],
  picked: ['Picked up', 'ತೆಗೆದುಕೊಂಡರು'],
  onway: ['On the way', 'ದಾರಿಯಲ್ಲಿದೆ'],
  nearby: ['Nearby', 'ಹತ್ತಿರದಲ್ಲಿದೆ'],
  delivered: ['Delivered', 'ತಲುಪಿತು'],
};

/**
 * Order packed → Picked up → On the way → Nearby → Delivered. Each step lights as it happens
 * (pop), the one happening now pulses. `mini` is the one-line version for the admin's list.
 */
export function Timeline({ steps, bi, mini }: { steps: DeliveryStep[]; bi: (en: string, kn: string) => string; mini?: boolean }) {
  return (
    <ol className={'timeline' + (mini ? ' mini' : '')}>
      {steps.map((s) => (
        <li key={s.key + (s.done ? '-d' : s.active ? '-a' : '')} className={'tl-step' + (s.done ? ' done' : '') + (s.active ? ' active' : '')} title={bi(...WORDS[s.key])}>
          <span className="tl-dot" aria-hidden />
          {!mini && (
            <span className="tl-text">
              {bi(...WORDS[s.key])}
              {s.at && (s.done || s.active) && <span className="muted"> · {clockText(s.at)}</span>}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
