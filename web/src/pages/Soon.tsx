import type { MsgKey } from '@stock/core';
import { useSession } from '../lib/session';

/** Every role other than admin, until its own screen is built in a later phase. */
export function SoonPage() {
  const { me, t } = useSession();
  return (
    <div className="card">
      <h1 className="title">{t('soon.title')}</h1>
      <p>{t('soon.body', { role: t(('role.' + me!.role) as MsgKey) })}</p>
    </div>
  );
}
