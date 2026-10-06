import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pickName } from '@stock/core';
import { http } from '../lib/api';
import { useLiveEvent } from '../lib/live';
import { useSession } from '../lib/session';
import type { HomeData } from '../roles/admin/Home';
import { useBi } from './ui';
import { Icon } from './Icon';

type Alert = HomeData['justLow'][number];

/**
 * The admin's live note when a sale or a move takes an item below its running-out level, in all
 * places together. The same item stays on Home's "Just went low" until it is stocked again.
 * Only on an open screen: there is no phone notification.
 */
export function LowToast() {
  const bi = useBi();
  const { lang } = useSession();
  const [shown, setShown] = useState<Alert | null>(null);
  useLiveEvent('low', (id) => {
    http
      .get<HomeData>('/admin/home')
      .then((s) => {
        const a = s.justLow.find((x) => x.itemId === id);
        if (a) setShown(a);
      })
      .catch(() => undefined);
  });
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 12_000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  return (
    <Link className="toast" role="status" to={'/admin/inventory/' + shown.itemId} onClick={() => setShown(null)}>
      <Icon name="refill" />
      <span className="grow">
        <b>{pickName(shown.nameEn, shown.nameKn, lang)}</b> {bi('is running low', 'ಮುಗಿಯುತ್ತಿದೆ')}
        <span className="muted">
          {' · '}
          {shown.words} {bi('left in all places', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ ಉಳಿದಿದೆ')}
        </span>
      </span>
      <Icon name="chevron" />
    </Link>
  );
}
