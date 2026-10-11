import { useEffect, useState, useSyncExternalStore } from 'react';
import { getActAs, http, onActAs, setActAs } from '../lib/api';
import { useLoad } from '../lib/session';
import { Select } from './Select';
import { useBi } from './ui';

/** The worker the admin's worker screens act for ('' for everyone), kept in step with the picker. */
export function useActAs(): string {
  return useSyncExternalStore(onActAs, getActAs, getActAs);
}

/**
 * "Acting for: Ravi ▾" at the top of the admin's worker screens. The admin stays signed in as the
 * admin; the screens below show and do what that worker's would, and the server records the
 * worker as who did it and the admin as who tapped it.
 */
export function ActingFor() {
  const bi = useBi();
  const actAs = useActAs();
  const { value: workers } = useLoad(() => http.get<{ id: string; name: string; phone: string }[]>('/admin/deliveries/workers'));
  // A worker switched off since they were picked: back to everyone.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!workers || checked) return;
    setChecked(true);
    if (actAs && !workers.some((w) => w.id === actAs)) setActAs('');
  }, [workers, actAs, checked]);
  return (
    <div className="bar" data-tour="acting-for">
      <span className="muted">{bi('Acting for', 'ಯಾರ ಪರವಾಗಿ')}</span>
      <Select
        className="w-auto"
        aria-label={bi('Acting for', 'ಯಾರ ಪರವಾಗಿ')}
        value={actAs}
        onChange={(v) => setActAs(v)}
        options={[{ value: '', label: bi('Everyone', 'ಎಲ್ಲರೂ') }, ...(workers ?? []).map((w) => ({ value: w.id, label: w.name }))]}
      />
    </div>
  );
}
