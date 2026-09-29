/**
 * The only way this system talks to the billing server, and it can only read.
 *
 * There is deliberately no post, put or delete here: stock never writes to billing. It signs in
 * with the shop PIN (the one POST billing's login needs, which changes nothing there) and then
 * only GETs.
 */
export interface BillingClient {
  get<T>(path: string): Promise<T>;
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

  return {
    async get<T>(path: string): Promise<T> {
      if (!path.startsWith('/api/')) throw new Error('Billing paths start with /api/');
      if (!token) await signIn();
      let r = await fetchImpl(base + path, { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 401) {
        await signIn();
        r = await fetchImpl(base + path, { headers: { Authorization: 'Bearer ' + token } });
      }
      if (!r.ok) throw new Error('Billing answered ' + r.status + ' for ' + path);
      return (await r.json()) as T;
    },
  };
}
