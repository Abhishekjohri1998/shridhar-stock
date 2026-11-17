/**
 * Opened inside the billing app's Stock tab (a WebView, which gives the page ReactNativeWebView)
 * rather than in a normal browser. Inside the app there is one sign-in, one sign-out, and one place
 * for backup and settings, all the app's: this page asks the app instead of showing its own.
 */
type Bridge = { postMessage: (s: string) => void };

function bridge(): Bridge | null {
  try {
    return (window as unknown as { ReactNativeWebView?: Bridge }).ReactNativeWebView ?? null;
  } catch {
    return null;
  }
}

export function inApp(): boolean {
  return bridge() != null;
}

/** What this page may ask the app: a fresh session, to sign out of both halves, or its Settings. */
export type AppAsk = { type: 'need-session' } | { type: 'sign-out' } | { type: 'open-settings' };

export function tellApp(msg: AppAsk): void {
  try {
    bridge()?.postMessage(JSON.stringify(msg));
  } catch {
    /* the app is going away */
  }
}

/** The event the app answers a need-session with: `detail.token` is a fresh stock session. */
export const APP_SESSION_EVENT = 'stock-session';
