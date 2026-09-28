import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { makeT, type Lang, type Person, type T } from '@stock/core';
import { api, hasToken, setToken, whenSignedOut } from './api';

interface Session {
  ready: boolean;
  me: Person | null;
  lang: Lang;
  t: T;
  setLang: (l: Lang) => void;
  signIn: (phone: string, pin: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);
const LANG_KEY = 'stock.lang';

function storedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'kn';
  } catch {
    return 'kn';
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Person | null>(null);
  const [ready, setReady] = useState(!hasToken());
  const [lang, setLangState] = useState<Lang>(storedLang);

  useEffect(() => {
    whenSignedOut(() => setMe(null));
    if (!hasToken()) return;
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* fine */
    }
  }, []);

  const signIn = useCallback(async (phone: string, pin: string) => {
    const r = await api.login(phone, pin);
    setToken(r.token);
    setMe(r.person);
  }, []);

  const signOut = useCallback(() => {
    setToken('');
    setMe(null);
  }, []);

  const value = useMemo(() => ({ ready, me, lang, t: makeT(lang), setLang, signIn, signOut }), [ready, me, lang, setLang, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** A small loader: runs `load`, keeps the result, the error, and a way to run it again. */
export function useLoad<V>(load: () => Promise<V>, deps: unknown[] = []) {
  const [value, setValue] = useState<V | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    load()
      .then((v) => live && setValue(v))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { value, error, reload: () => setTick((n) => n + 1) };
}
