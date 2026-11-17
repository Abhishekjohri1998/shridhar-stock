import { useEffect, useState } from 'react';
import { useBi } from '../components/ui';
import { tellApp } from '../lib/inApp';

/** How often the app is asked again, and how long before the page says what else to try. */
const ASK_EVERY_MS = 4000;
const HINT_AFTER_MS = 30000;

/**
 * Inside the billing app, in place of stock's own sign-in: the app signed this person in once,
 * so the page asks it for a fresh session and waits. The app answers through lib/inApp.ts's
 * event; until then the page keeps asking. Never a phone and PIN form.
 */
export function SigningInPage() {
  const bi = useBi();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    tellApp({ type: 'need-session' });
    const every = setInterval(() => tellApp({ type: 'need-session' }), ASK_EVERY_MS);
    const hint = setTimeout(() => setSlow(true), HINT_AFTER_MS);
    return () => {
      clearInterval(every);
      clearTimeout(hint);
    };
  }, []);
  return (
    <div className="login card" role="status" aria-live="polite">
      <h1 className="title">{bi('Signing you in…', 'ಸೈನ್ ಇನ್ ಮಾಡಲಾಗುತ್ತಿದೆ…')}</h1>
      <p className="muted">{bi('Using the sign-in of the app. This takes a moment.', 'ಆ್ಯಪ್‌ನ ಸೈನ್ ಇನ್ ಬಳಸಲಾಗುತ್ತಿದೆ. ಸ್ವಲ್ಪ ಕಾಯಿರಿ.')}</p>
      {slow && (
        <>
          <p className="muted">
            {bi(
              'Still trying. Check the internet. If it does not open, sign out of the app and sign in again.',
              'ಇನ್ನೂ ಪ್ರಯತ್ನಿಸುತ್ತಿದೆ. ಇಂಟರ್ನೆಟ್ ಪರಿಶೀಲಿಸಿ. ತೆರೆಯದಿದ್ದರೆ, ಆ್ಯಪ್‌ನಿಂದ ಸೈನ್ ಔಟ್ ಮಾಡಿ ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.',
            )}
          </p>
          <button type="button" className="btn" onClick={() => tellApp({ type: 'sign-out' })}>
            {bi('Sign out of the app', 'ಆ್ಯಪ್‌ನಿಂದ ಸೈನ್ ಔಟ್')}
          </button>
        </>
      )}
    </div>
  );
}
