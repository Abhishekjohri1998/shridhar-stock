import { useState, type FormEvent } from 'react';
import type { Location } from '@stock/core';
import { api } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';

export function PlacesPage() {
  const { t } = useSession();
  const { value: locs, error, reload } = useLoad(() => api.locations());
  const [editing, setEditing] = useState<Location | 'new' | null>(null);

  if (error) return <div className="msg err">{error}</div>;
  return (
    <>
      <h1 className="title">{t('places.title')}</h1>
      <div className="bar">
        <button className="btn primary" onClick={() => setEditing('new')}>
          + {t('places.new')}
        </button>
      </div>
      {editing && (
        <PlaceForm
          place={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {(locs ?? []).map((l) => (
        <div className="card clickable" key={l.id} onClick={() => setEditing(l)}>
          <span className="name">{l.name}</span> {l.nameKn && <span className="muted">· {l.nameKn}</span>}{' '}
          <span className="pill">{l.kind === 'shop' ? t('places.shop') : t('places.godown')}</span>
          {!l.active && <span className="pill bad"> {t('people.off')}</span>}
          {l.address && <div className="muted">{l.address}</div>}
        </div>
      ))}
    </>
  );
}

function PlaceForm({ place, onDone }: { place: Location | null; onDone: () => void }) {
  const { t } = useSession();
  const [name, setName] = useState(place?.name ?? '');
  const [nameKn, setNameKn] = useState(place?.nameKn ?? '');
  const [address, setAddress] = useState(place?.address ?? '');
  const [error, setError] = useState('');

  const save = async (e: FormEvent | null, active?: boolean) => {
    e?.preventDefault();
    setError('');
    try {
      const body = { name, nameKn, address, ...(active != null ? { active } : {}) };
      if (place) await api.updateLocation(place.id, body);
      else await api.addLocation(body);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="card" onSubmit={(e) => save(e)}>
      {error && <div className="msg err">{error}</div>}
      <div className="grid2">
        <label className="field">
          <span>{t('places.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('places.nameKn')}</span>
          <input value={nameKn} onChange={(e) => setNameKn(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>{t('places.address')}</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <div className="bar">
        <button className="btn primary">{t('common.save')}</button>
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        {place && place.kind === 'godown' && (
          <button type="button" className="btn" onClick={() => save(null, !place.active)}>
            {place.active ? t('people.switchOff') : t('people.switchOn')}
          </button>
        )}
      </div>
    </form>
  );
}
