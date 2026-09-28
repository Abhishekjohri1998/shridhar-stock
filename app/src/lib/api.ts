import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import type { AdjustReason, Item, ItemInput, Location, Person, Role, StockLevel, StockMove } from '@stock/core';

/**
 * The same API as the website's, over the stock server's address.
 *
 * This app talks only to the stock server. It has no idea where the billing server is and no
 * code that could reach it.
 */

const KEY_URL = 'stock.serverUrl';
const KEY_TOKEN = 'stock.token';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function defaultServerUrl(): string {
  const extra = Constants.expoConfig?.extra as { serverUrl?: string } | undefined;
  return extra?.serverUrl ?? '';
}

let baseUrl = '';
let token = '';
let onSignedOut: () => void = () => undefined;

export function whenSignedOut(fn: () => void): void {
  onSignedOut = fn;
}

export async function loadStored(): Promise<{ baseUrl: string; hasToken: boolean }> {
  const [u, t] = await Promise.all([AsyncStorage.getItem(KEY_URL), AsyncStorage.getItem(KEY_TOKEN)]);
  baseUrl = u || defaultServerUrl();
  token = t ?? '';
  return { baseUrl, hasToken: !!token };
}

/** Tidies what someone typed into an address: no trailing slash, https:// when left out. */
export function cleanUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

export async function setServerUrl(url: string): Promise<void> {
  baseUrl = cleanUrl(url);
  await AsyncStorage.setItem(KEY_URL, baseUrl);
}

export const serverUrl = () => baseUrl;

export async function setToken(t: string): Promise<void> {
  token = t;
  if (t) await AsyncStorage.setItem(KEY_TOKEN, t);
  else await AsyncStorage.removeItem(KEY_TOKEN);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(baseUrl + '/api' + path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      await setToken('');
      onSignedOut();
    }
    throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? 'Something went wrong');
  }
  return body as T;
}

const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/**
 * Saves a CSV the server makes into the app's cache folder, with the sign-in attached, and gives
 * back where it went, for the share sheet.
 */
export async function downloadCsv(path: string, name: string): Promise<string> {
  const target = FileSystem.cacheDirectory + name;
  const r = await FileSystem.downloadAsync(baseUrl + '/api' + path, target, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status !== 200) {
    let message = 'Could not make the file';
    try {
      message = (JSON.parse(await FileSystem.readAsStringAsync(target)) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(r.status, message);
  }
  return r.uri;
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  login: (phone: string, pin: string) => request<{ token: string; person: Person }>('/auth/login', send('POST', { phone, pin })),
  me: () => request<Person>('/me'),

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

  stock: () => request<StockLevel[]>('/stock'),
  moves: (itemId: string) => request<StockMove[]>('/items/' + itemId + '/moves?limit=30'),
  openStock: (itemId: string, locationId: string, qty: number) =>
    request<{ posted: number }>('/stock/open', send('POST', { itemId, locationId, qty })),
  adjust: (a: { itemId: string; locationId: string; actual: number; reason: AdjustReason; note?: string; requestId: string }) =>
    request<{ posted: number; qty: number }>('/stock/adjust', send('POST', a)),
  recount: () => request<{ checked: number; fixed: unknown[] }>('/stock/recount', { method: 'POST' }),
};

/** A request id, so a correction sent twice by a double tap is posted once. */
export function requestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
