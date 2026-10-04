/**
 * The only way this system talks to the billing server.
 *
 * It signs in with the shop PIN and mostly reads. The two writes are small and named, and go
 * through billing/push.ts only: a line's given tick, and a customer's address.
 */
export interface BillingClient {
  get<T>(path: string): Promise<T>;
  /** One of the two writes push.ts makes. Nothing else writes to billing. */
  send<T>(method: 'PATCH' | 'PUT', path: string, body: unknown): Promise<T>;
}

export function billingClient(baseUrl: string, pin: string, fetchImpl: typeof fetch = fetch): BillingClient {
  const base = baseUrl.replace(/\/+$/, '');
  let token = '';

  async function signIn(): Promise<void> {
    const r = await fetchImpl(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!r.ok) throw new Error('Billing refused the PIN (' + r.status + ')');
    token = ((await r.json()) as { token: string }).token;
  }

  /** Signs in when needed, and once more if billing has forgotten the token. */
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/')) throw new Error('Billing paths start with /api/');
    if (!token) await signIn();
    const go = () => fetchImpl(base + path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: 'Bearer ' + token } });
    let r = await go();
    if (r.status === 401) {
      await signIn();
      r = await go();
    }
    if (!r.ok) throw new Error('Billing answered ' + r.status + ' for ' + path);
    return (await r.json()) as T;
  }

  return {
    get: <T>(path: string) => call<T>(path),
    send: <T>(method: 'PATCH' | 'PUT', path: string, body: unknown) =>
      call<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
}
