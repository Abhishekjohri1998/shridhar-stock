import { lazy, Suspense } from 'react';
import { useSession } from '../lib/session';

/*
 * The light end of the explainer: the card on Home and the once-per-device offer. The player and
 * its scenes are a large download, fetched only when the explainer is actually opened.
 */
const LazyModal = lazy(() => import('./Player').then((m) => ({ default: m.ExplainerModal })));

/** The player over the whole screen, loaded when first opened. */
export function ExplainerModal(props: { onClose: () => void; offer?: boolean }) {
  return (
    <Suspense fallback={null}>
      <LazyModal {...props} />
    </Suspense>
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
