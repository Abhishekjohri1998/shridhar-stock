import type { ItemSupplierRow, StockInfo, Item, ItemInput, Location, Person, Role, StockLevel, StockMove, AdjustReason } from '@stock/core';

import { takeHandoff } from './handoff';

const TOKEN_KEY = 'stock.token';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window: the session lasts as long as the tab */
  }
  memToken = token;
}

// A session handed over by the billing app wins over whatever was kept here.
let memToken = takeHandoff(TOKEN_KEY) ?? readToken();
export const hasToken = () => !!memToken;

/** Called when the server says the session is over, so the app can go back to sign-in. */
let onSignedOut: () => void = () => undefined;
export function whenSignedOut(fn: () => void): void {
  onSignedOut = fn;
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(memToken ? { Authorization: 'Bearer ' + memToken } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (!res.ok) {
    let message = 'Something went wrong';
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && path !== '/auth/login') {
      setToken('');
      onSignedOut();
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await raw(path, init);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** Downloads a file the server makes, with the sign-in attached, and saves it under `name`. */
export async function download(path: string, name: string): Promise<void> {
  const blob = await (await raw(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ImportReport {
  added: number;
  changed: number;
  unchanged: number;
  errors: { row: number; message: string }[];
  applied: boolean;
}

/** For the role screens: plain reads and posts against the API. */
export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, send('POST', body)),
  put: <T>(path: string, body: unknown) => request<T>(path, send('PUT', body)),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export const api = {
  demoPeople: () => request<{ role: Role; name: string; phone: string }[]>('/demo/people'),
  loginAs: (role: Role) => request<{ token: string; person: Person }>('/demo/login-as', send('POST', { role })),
  resetDemo: () => request<{ ok: true }>('/demo/reset', { method: 'POST' }),
  login: (phone: string, pin: string) => request<{ token: string; person: Person }>('/auth/login', send('POST', { phone, pin })),
  me: () => request<Person>('/me'),
  changePin: (oldPin: string, newPin: string) => request<{ ok: true }>('/auth/pin', send('POST', { oldPin, newPin })),

  people: () => request<Person[]>('/people'),
  addPerson: (p: { name: string; phone: string; role: Role; linkedId?: string; pin: string }) => request<Person>('/people', send('POST', p)),
  updatePerson: (id: string, p: { name?: string; role?: Role; linkedId?: string; active?: boolean }) =>
    request<Person>('/people/' + id, send('PUT', p)),
  resetPin: (id: string, pin: string) => request<{ ok: true }>('/people/' + id + '/pin', send('POST', { pin })),

  locations: () => request<Location[]>('/locations'),
  addLocation: (l: { name: string; nameKn: string; address?: string }) => request<Location>('/locations', send('POST', l)),
  updateLocation: (id: string, l: { name: string; nameKn: string; address?: string; active?: boolean }) =>
    request<Location>('/locations/' + id, send('PUT', l)),

  items: (all = false) => request<Item[]>('/items' + (all ? '?all=1' : '')),
  item: (id: string) => request<Item>('/items/' + id),
  addItem: (i: ItemInput) => request<Item>('/items', send('POST', i)),
  saveItem: (id: string, i: ItemInput) => request<Item>('/items/' + id, send('PUT', i)),
  categories: () => request<string[]>('/categories'),
  racks: () => request<Record<string, string[]>>('/racks'),
  itemInfo: (id: string) => request<{ info: StockInfo; suppliers: ItemSupplierRow[] }>('/items/' + id + '/info'),
  itemSuppliers: () => request<Record<string, ItemSupplierRow[]>>('/item-suppliers'),

  stock: () => request<StockLevel[]>('/stock'),
  moves: (itemId: string) => request<StockMove[]>('/items/' + itemId + '/moves?limit=30'),
  openStock: (itemId: string, locationId: string, qty: number) =>
    request<{ posted: number }>('/stock/open', send('POST', { itemId, locationId, qty })),
  adjust: (a: { itemId: string; locationId: string; actual: number; reason: AdjustReason; note?: string; requestId: string }) =>
    request<{ posted: number; qty: number }>('/stock/adjust', send('POST', a)),
  recount: () => request<{ checked: number; fixed: unknown[] }>('/stock/recount', { method: 'POST' }),

  importItems: (csv: string, dry: boolean) => request<ImportReport>('/import/items', send('POST', { csv, dry })),
};
