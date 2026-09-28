import { useState, type FormEvent } from 'react';
import { useSession } from '../lib/session';

export function LoginPage() {
  const { t, signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(phone, pin);
    } catch (err) {
      setError((err as Error).message === 'offline' ? t('common.offline') : (err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login card" onSubmit={submit}>
      <h1 className="title">{t('login.title')}</h1>
      {error && <div className="msg err">{error}</div>}
      <label className="field">
        <span>{t('login.phone')}</span>
        <input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </label>
      <label className="field">
        <span>{t('login.pin')}</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          required
        />
      </label>
      <button className="btn primary" disabled={busy || !phone || pin.length < 4}>
        {t('login.go')}
      </button>
    </form>
  );
}
