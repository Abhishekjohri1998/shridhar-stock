import { tokenFromHash } from '@stock/core';

/**
 * The billing app's Stock tab opens this site already signed in, with "#token=<jwt>" in the
 * address. The token is kept as the session and taken out of the address at once, so it is not
 * left in the history or a shared link. Runs before the session is first read.
 */
export function takeHandoff(storageKey: string): string | null {
  try {
    const got = tokenFromHash(window.location.hash);
    if (!got) return null;
    try {
      localStorage.setItem(storageKey, got.token);
    } catch {
      /* private window: the session still lasts the tab */
    }
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + got.rest);
    return got.token;
  } catch {
    return null;
  }
}
