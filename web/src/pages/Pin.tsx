import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

/** Changing your own PIN signs you out everywhere, so this ends by going back to sign-in. */
export function PinPage() {
  const { t, signOut } = useSession();
  const [oldPin, setOld] = useState('');
  const [newPin, setNew] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.changePin(oldPin, newPin);
      setDone(true);
      setTimeout(signOut, 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  return (
    <form className="login card" onSubmit={submit}>
      <h1 className="title">{t('login.changePin')}</h1>
      {error && <div className="msg err">{error}</div>}
      {done && <div className="msg ok">{t('login.pinChanged')}</div>}
      <label className="field">
        <span>{t('login.oldPin')}</span>
        <input type="password" inputMode="numeric" value={oldPin} onChange={(e) => setOld(digits(e.target.value))} />
      </label>
      <label className="field">
        <span>{t('login.newPin')}</span>
        <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNew(digits(e.target.value))} />
      </label>
      <button className="btn primary" disabled={done || oldPin.length < 4 || newPin.length < 4}>
        {t('common.save')}
      </button>
    </form>
  );
}
