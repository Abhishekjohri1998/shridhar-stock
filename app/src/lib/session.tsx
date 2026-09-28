import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { makeT, type Lang, type Person, type T } from '@stock/core';
import { api, loadStored, setToken, whenSignedOut } from './api';

interface Session {
  ready: boolean;
  me: Person | null;
  lang: Lang;
  t: T;
  setLang: (l: Lang) => void;
  signIn: (phone: string, pin: string) => Promise<void>;
  signOut: () => void;
  /** Bumped after anything changes, so every screen that shows stock reads it again. */
  version: number;
  changed: () => void;
}

const Ctx = createContext<Session | null>(null);
const KEY_LANG = 'stock.lang';

/** Admin work only. Everyone else has their screen on the website. */
export class NotAdminError extends Error {}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Person | null>(null);
  const [lang, setLangState] = useState<Lang>('kn');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    whenSignedOut(() => setMe(null));
    (async () => {
      const stored = await AsyncStorage.getItem(KEY_LANG);
      if (stored === 'en' || stored === 'kn') setLangState(stored);
      const { hasToken } = await loadStored();
      if (hasToken) {
        try {
          const p = await api.me();
          if (p.role === 'admin') setMe(p);
          else await setToken('');
        } catch {
          /* offline or expired: the sign-in screen says which */
        }
      }
      setReady(true);
    })();
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(KEY_LANG, l).catch(() => undefined);
  }, []);

  const signIn = useCallback(async (phone: string, pin: string) => {
    const r = await api.login(phone, pin);
    if (r.person.role !== 'admin') throw new NotAdminError();
    await setToken(r.token);
    setMe(r.person);
  }, []);

  const signOut = useCallback(() => {
    setToken('').catch(() => undefined);
    setMe(null);
  }, []);

  const changed = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({ ready, me, lang, t: makeT(lang), setLang, signIn, signOut, version, changed }),
    [ready, me, lang, setLang, signIn, signOut, version, changed],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Runs `load` and keeps its result; runs again when `deps` change or on `reload()`. */
export function useLoad<V>(load: () => Promise<V>, deps: unknown[] = []) {
  const [value, setValue] = useState<V | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    load()
      .then((v) => live && setValue(v))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { value, error, busy, reload: () => setTick((n) => n + 1) };
}
